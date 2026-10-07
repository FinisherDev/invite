import crypto from 'node:crypto';
import { EventStatus, OrderStatus, Prisma, RefundReason } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { AppError, NotFound } from '../../lib/errors';
import { paystack, ProviderError } from '../../lib/paystack';

export async function initializePayment(orderId: string, attendeeId: string) {
  const order = await prisma.order.findFirst({
    where: { id: orderId, attendeeId, status: OrderStatus.PENDING, expiresAt: { gt: new Date() } },
    include: { attendee: { select: { email: true } } },
  });
  if (!order) throw NotFound('Pending order');
  // Paystack rejects a reused reference, so repeat calls return the stored checkout URL.
  if (order.paymentUrl) return { authorizationUrl: order.paymentUrl, reference: order.paymentRef };

  try {
    const { authorizationUrl } = await paystack.initialize({
      email: order.attendee.email,
      amountMinor: order.totalMinor,
      currency: order.currency,
      reference: order.paymentRef,
    });
    await prisma.order.update({
      where: { id: order.id },
      data: { paymentUrl: authorizationUrl, paymentInitializedAt: new Date() },
    });
    return { authorizationUrl, reference: order.paymentRef };
  } catch (e) {
    if (e instanceof ProviderError) throw new AppError(502, 'PAYMENT_PROVIDER', 'Payment provider unavailable, try again');
    throw e;
  }
}

export function verifySignature(rawBody: Buffer, signature: string | undefined): boolean {
  if (!signature) return false;
  const expected = Buffer.from(crypto.createHmac('sha512', process.env.PAYSTACK_SECRET_KEY!).update(rawBody).digest('hex'));
  const given = Buffer.from(signature);
  return expected.length === given.length && crypto.timingSafeEqual(expected, given); // timingSafeEqual throws on length mismatch
}

export type ChargeResult =
  | { status: 'ignored' }
  | { status: 'amount_mismatch'; orderId: string }
  | { status: 'paid' | 'reinstated' | 'refund_queued'; orderId: string };

type OrderCtx = Prisma.OrderGetPayload<{ include: { items: true; event: { select: { status: true } } } }>;
const UNPAID: OrderStatus[] = [OrderStatus.PENDING, OrderStatus.EXPIRED, OrderStatus.CANCELLED];

async function issueTickets(tx: Prisma.TransactionClient, order: OrderCtx) {
  const tickets = order.items.flatMap((item) =>
    Array.from({ length: item.quantity }, () => ({
      code: crypto.randomBytes(16).toString('base64url'),
      orderId: order.id,
      eventId: order.eventId,
      categoryId: item.categoryId,
      attendeeId: order.attendeeId,
    })),
  );
  await tx.ticket.createMany({ data: tickets });
}

/** All-or-nothing stock grab; undoes partial grabs itself. */
async function takeStock(tx: Prisma.TransactionClient, items: OrderCtx['items']): Promise<boolean> {
  const taken: OrderCtx['items'] = [];
  for (const item of items) {
    const r = await tx.ticketCategory.updateMany({
      where: { id: item.categoryId, available: { gte: item.quantity } },
      data: { available: { decrement: item.quantity } },
    });
    if (r.count === 0) {
      for (const t of taken)
        await tx.ticketCategory.update({ where: { id: t.categoryId }, data: { available: { increment: t.quantity } } });
      return false;
    }
    taken.push(item);
  }
  return true;
}

/** Money arrived for an order we had already released. Reinstate if stock remains, otherwise refund. */
async function reinstateOrRefund(tx: Prisma.TransactionClient, order: OrderCtx): Promise<ChargeResult> {
  const claimed = await tx.order.updateMany({
    where: { id: order.id, status: { in: [OrderStatus.EXPIRED, OrderStatus.CANCELLED] } },
    data: { status: OrderStatus.PAID, paidAt: new Date() },
  });
  if (claimed.count === 0) return { status: 'ignored' }; // a duplicate delivery got here first

  if (order.event.status === EventStatus.PUBLISHED && (await takeStock(tx, order.items))) {
    await issueTickets(tx, order);
    return { status: 'reinstated', orderId: order.id };
  }
  await tx.order.update({ where: { id: order.id }, data: { status: OrderStatus.REFUND_PENDING } });
  await tx.refund.create({
    data: { orderId: order.id, amountMinor: order.totalMinor, reason: RefundReason.LATE_PAYMENT, restock: false },
  });
  return { status: 'refund_queued', orderId: order.id };
}

/** Idempotent: webhooks are delivered at-least-once, and reconciliation may call this too. */
export async function handleChargeSuccess(reference: string, paidAmountMinor: number): Promise<ChargeResult> {
  const result = await prisma.$transaction(
    async (tx): Promise<ChargeResult> => {
      const order = await tx.order.findUnique({
        where: { paymentRef: reference },
        include: { items: { orderBy: { categoryId: 'asc' } }, event: { select: { status: true } } },
      });
      if (!order || !UNPAID.includes(order.status)) return { status: 'ignored' };
      if (order.totalMinor !== paidAmountMinor) return { status: 'amount_mismatch', orderId: order.id };

      const won = await tx.order.updateMany({
        where: { id: order.id, status: OrderStatus.PENDING },
        data: { status: OrderStatus.PAID, paidAt: new Date() },
      });
      if (won.count === 1) {
        await issueTickets(tx, order);
        return { status: 'paid', orderId: order.id };
      }
      // No longer pending: it expired or was cancelled between our read and write.
      return reinstateOrRefund(tx, order);
    },
    { timeout: 15_000 },
  );

  if (result.status === 'amount_mismatch') logger.error({ reference, paidAmountMinor }, 'payment amount mismatch, needs manual review');
  if (result.status === 'refund_queued') logger.warn({ reference }, 'late payment with no stock, refund queued');
  return result;
}