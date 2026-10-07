import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../../src/lib/prisma';
import { paystack } from '../../src/lib/paystack';
import { checkIn } from '../../src/modules/tickets/ticket.service';
import {
  handleRefundProcessed, queueRefund, refundCancelledEventOrders, submitPendingRefunds,
} from '../../src/modules/refunds/refund.service';
import { seedPaidOrder } from '../helpers/factories';

vi.mock('../../src/lib/paystack', () => ({
  paystack: { initialize: vi.fn(), verify: vi.fn(), refund: vi.fn() },
  ProviderError: class extends Error {},
}));

const stock = async (id: string) => (await prisma.ticketCategory.findUniqueOrThrow({ where: { id } })).available;
beforeEach(() => vi.resetAllMocks());

describe('refunds', () => {
  it('runs the full lifecycle: queue, submit, confirm, restock', async () => {
    const { order, category, attendee } = await seedPaidOrder(2, 10);
    const refund = await queueRefund(order.id, { kind: 'attendee', attendeeId: attendee.id });

    expect(refund?.status).toBe('PENDING');
    expect(await prisma.ticket.count({ where: { orderId: order.id, status: 'VOID' } })).toBe(2);
    expect(await stock(category.id)).toBe(8); // not restocked until the money is confirmed back

    vi.mocked(paystack.refund).mockResolvedValue({ providerRef: 'rf_1' });
    await submitPendingRefunds();
    expect((await prisma.refund.findUniqueOrThrow({ where: { orderId: order.id } })).status).toBe('SUBMITTED');

    expect(await handleRefundProcessed(order.paymentRef)).toBe('processed');
    expect(await handleRefundProcessed(order.paymentRef)).toBe('ignored'); // duplicate webhook
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('REFUNDED');
    expect(await stock(category.id)).toBe(10); // restocked exactly once
  });

  it('creates one refund when requested concurrently', async () => {
    const { order, attendee } = await seedPaidOrder(1);
    const actor = { kind: 'attendee' as const, attendeeId: attendee.id };
    const results = await Promise.allSettled([queueRefund(order.id, actor), queueRefund(order.id, actor), queueRefund(order.id, actor)]);
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
    expect(await prisma.refund.count({ where: { orderId: order.id } })).toBe(1);
  });

  it("won't let one attendee refund another's order", async () => {
    const { order } = await seedPaidOrder(1);
    await expect(queueRefund(order.id, { kind: 'attendee', attendeeId: '00000000-0000-4000-8000-000000000000' }))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('blocks customer refunds inside the cutoff window', async () => {
    const { order, attendee } = await seedPaidOrder(1, 10, 1); // starts in 1 day, cutoff is 48h
    await expect(queueRefund(order.id, { kind: 'attendee', attendeeId: attendee.id }))
      .rejects.toMatchObject({ code: 'REFUND_WINDOW_CLOSED' });
  });

  it('blocks a refund once a ticket has been used, leaving everything untouched', async () => {
    const { order, attendee, event, organizer } = await seedPaidOrder(2);
    const [t1] = await prisma.ticket.findMany({ where: { orderId: order.id } });
    await checkIn(organizer.id, event.id, t1.code);

    await expect(queueRefund(order.id, { kind: 'attendee', attendeeId: attendee.id }))
      .rejects.toMatchObject({ code: 'TICKETS_USED' });
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('PAID');
    expect(await prisma.ticket.count({ where: { orderId: order.id, status: 'VOID' } })).toBe(0);
    expect(await prisma.refund.count()).toBe(0);
  });

  it('retries provider failures, then marks FAILED after 5 attempts', async () => {
    const { order, attendee } = await seedPaidOrder(1);
    await queueRefund(order.id, { kind: 'attendee', attendeeId: attendee.id });
    vi.mocked(paystack.refund).mockRejectedValue(new Error('provider down'));

    for (let i = 0; i < 5; i++) await submitPendingRefunds();

    const refund = await prisma.refund.findUniqueOrThrow({ where: { orderId: order.id } });
    expect(refund).toMatchObject({ status: 'FAILED', attempts: 5 });
    expect(refund.lastError).toContain('provider down');
  });

  it('refunds every paid order of a cancelled event, without restocking', async () => {
    const a = await seedPaidOrder(1);
    await prisma.event.update({ where: { id: a.event.id }, data: { status: 'CANCELLED' } });

    const { queued } = await refundCancelledEventOrders();

    expect(queued).toBe(1);
    const refund = await prisma.refund.findUniqueOrThrow({ where: { orderId: a.order.id } });
    expect(refund).toMatchObject({ reason: 'EVENT_CANCELLED', restock: false });
    expect((await refundCancelledEventOrders()).queued).toBe(0); // idempotent
  });
});