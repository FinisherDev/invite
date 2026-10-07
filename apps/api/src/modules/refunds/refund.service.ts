import { EventStatus, OrderStatus, RefundReason, RefundStatus, TicketStatus, type Refund } from '@prisma/client';
import { env } from '../../config/env';
import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { Conflict, NotFound } from '../../lib/errors';
import { paystack } from '../../lib/paystack';

export type RefundActor = { kind: 'attendee'; attendeeId: string } | { kind: 'system' };
const MAX_ATTEMPTS = 5;

/**
 * Phase 1: record the refund intent atomically (void tickets, flip order state, insert Refund row).
 * Nothing here calls the provider. The process-refunds job does, with retries.
 * System actors only refund cancelled events; they return null instead of throwing.
 */
export async function queueRefund(orderId: string, actor: RefundActor): Promise<Refund | null> {
  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findFirst({
      where: { id: orderId, ...(actor.kind === 'attendee' && { attendeeId: actor.attendeeId }) },
      include: { event: true, tickets: true, refund: true },
    });
    if (!order) throw NotFound('Order');
    const isAttendee = actor.kind === 'attendee';

    if (order.refund) return isAttendee ? order.refund : null; // idempotent
    if (order.status !== OrderStatus.PAID) {
      if (!isAttendee) return null;
      throw Conflict('NOT_REFUNDABLE', 'Only paid orders can be refunded');
    }

    const cancelled = order.event.status === EventStatus.CANCELLED;
    if (!isAttendee && !cancelled) return null;
    const reason = cancelled ? RefundReason.EVENT_CANCELLED : RefundReason.CUSTOMER_REQUEST;

    if (reason === RefundReason.CUSTOMER_REQUEST) {
      const msLeft = order.event.startsAt.getTime() - Date.now();
      if (msLeft < env.REFUND_CUTOFF_HOURS * 3_600_000)
        throw Conflict('REFUND_WINDOW_CLOSED', `Refunds close ${env.REFUND_CUTOFF_HOURS} hours before the event`);
    }

    // The row lock from this CAS serializes concurrent requests for the same order.
    const claimed = await tx.order.updateMany({
      where: { id: order.id, status: OrderStatus.PAID },
      data: { status: OrderStatus.REFUND_PENDING },
    });
    if (claimed.count === 0) {
      const existing = await tx.refund.findUnique({ where: { orderId: order.id } });
      if (existing && isAttendee) return existing;
      if (!isAttendee) return null;
      throw Conflict('NOT_REFUNDABLE', 'This order is no longer refundable');
    }

    // Voiding is race-safe against check-in: a ticket is either VOID or CHECKED_IN, never both.
    const usable =
      reason === RefundReason.CUSTOMER_REQUEST
        ? [TicketStatus.VALID]
        : [TicketStatus.VALID, TicketStatus.CHECKED_IN];
    const voided = await tx.ticket.updateMany({
      where: { orderId: order.id, status: { in: usable } },
      data: { status: TicketStatus.VOID },
    });
    if (reason === RefundReason.CUSTOMER_REQUEST && voided.count !== order.tickets.length)
      throw Conflict('TICKETS_USED', 'Some tickets were already used, so this order cannot be refunded'); // rolls everything back

    return tx.refund.create({
      data: { orderId: order.id, amountMinor: order.totalMinor, reason, restock: reason === RefundReason.CUSTOMER_REQUEST },
    });
  });
}

/** Phase 2 (cron): send PENDING refunds to the provider. Retries up to MAX_ATTEMPTS, then FAILED for manual review. */
export async function submitPendingRefunds(batchSize = 50) {
  const pending = await prisma.refund.findMany({
    where: { status: RefundStatus.PENDING },
    include: { order: { select: { paymentRef: true } } },
    orderBy: { createdAt: 'asc' },
    take: batchSize,
  });
  let submitted = 0;
  let failed = 0;
  for (const r of pending) {
    try {
      const { providerRef } = await paystack.refund({ reference: r.order.paymentRef, amountMinor: r.amountMinor });
      await prisma.refund.update({
        where: { id: r.id },
        data: { status: RefundStatus.SUBMITTED, providerRef, attempts: { increment: 1 }, lastError: null },
      });
      submitted++;
    } catch (e) {
      const attempts = r.attempts + 1;
      const giveUp = attempts >= MAX_ATTEMPTS;
      await prisma.refund.update({
        where: { id: r.id },
        data: { attempts, lastError: String(e).slice(0, 500), status: giveUp ? RefundStatus.FAILED : RefundStatus.PENDING },
      });
      if (giveUp) logger.error({ refundId: r.id }, 'refund failed permanently, needs manual action');
      failed++;
    }
  }
  return { submitted, failed };
}

/** Phase 3 (webhook): provider confirms the money is back. */
export async function handleRefundProcessed(transactionReference: string) {
  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({
      where: { paymentRef: transactionReference },
      include: { items: { orderBy: { categoryId: 'asc' } }, refund: true },
    });
    if (!order?.refund) return 'ignored' as const;

    // PENDING is included because the webhook can beat our own SUBMITTED update.
    const done = await tx.refund.updateMany({
      where: { id: order.refund.id, status: { in: [RefundStatus.PENDING, RefundStatus.SUBMITTED] } },
      data: { status: RefundStatus.PROCESSED, processedAt: new Date() },
    });
    if (done.count === 0) return 'ignored' as const;

    await tx.order.update({ where: { id: order.id }, data: { status: OrderStatus.REFUNDED } });
    if (order.refund.restock) {
      for (const item of order.items)
        await tx.ticketCategory.update({ where: { id: item.categoryId }, data: { available: { increment: item.quantity } } });
    }
    return 'processed' as const;
  });
}

export async function handleRefundFailed(transactionReference: string) {
  const order = await prisma.order.findUnique({ where: { paymentRef: transactionReference }, select: { id: true } });
  if (!order) return;
  await prisma.refund.updateMany({
    where: { orderId: order.id, status: { in: [RefundStatus.PENDING, RefundStatus.SUBMITTED] } },
    data: { status: RefundStatus.FAILED, lastError: 'Provider reported failure' },
  });
  logger.error({ orderId: order.id }, 'provider reported refund failure, needs manual action');
}

/** Cron: cancelled events get every paid order refunded, in batches. A cursor skips orders that keep failing. */
export async function refundCancelledEventOrders(batchSize = 200, maxBatches = 20) {
  let queued = 0;
  let cursor: string | undefined;
  for (let i = 0; i < maxBatches; i++) {
    const orders = await prisma.order.findMany({
      where: { status: OrderStatus.PAID, event: { status: EventStatus.CANCELLED }, ...(cursor && { id: { gt: cursor } }) },
      select: { id: true },
      orderBy: { id: 'asc' },
      take: batchSize,
    });
    if (orders.length === 0) break;
    for (const { id } of orders) {
      try {
        if (await queueRefund(id, { kind: 'system' })) queued++;
      } catch (err) {
        logger.error({ err, orderId: id }, 'could not queue refund for cancelled event');
      }
    }
    cursor = orders[orders.length - 1].id;
  }
  return { queued };
}