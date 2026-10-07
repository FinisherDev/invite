import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../../src/lib/prisma';
import { paystack } from '../../src/lib/paystack';
import { cleanup } from '../../src/jobs/cleanup';
import { completeEvents } from '../../src/jobs/complete-events';
import { reconcilePayments } from '../../src/jobs/reconcile-payments';
import { createOrder } from '../../src/modules/orders/order.service';
import { seedAttendee, seedEvent } from '../helpers/factories';

vi.mock('../../src/lib/paystack', () => ({
  paystack: { initialize: vi.fn(), verify: vi.fn(), refund: vi.fn() },
  ProviderError: class extends Error {},
}));
beforeEach(() => vi.resetAllMocks());

async function pendingOrder() {
  const { event, category } = await seedEvent(5);
  const a = await seedAttendee();
  const order = await createOrder(a.id, {
    eventId: event.id, idempotencyKey: randomUUID(), items: [{ categoryId: category.id, quantity: 2 }],
  });
  await prisma.order.update({ where: { id: order.id }, data: { paymentInitializedAt: new Date(Date.now() - 10 * 60_000) } });
  return order;
}

describe('reconcilePayments', () => {
  it('recovers a payment whose webhook never arrived', async () => {
    const order = await pendingOrder();
    vi.mocked(paystack.verify).mockResolvedValue({ status: 'success', amountMinor: order.totalMinor });

    expect(await reconcilePayments()).toMatchObject({ checked: 1, recovered: 1 });
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('PAID');
    expect(await prisma.ticket.count({ where: { orderId: order.id } })).toBe(2);
  });

  it('leaves abandoned checkouts alone and does not re-check them immediately', async () => {
    const order = await pendingOrder();
    vi.mocked(paystack.verify).mockResolvedValue({ status: 'abandoned', amountMinor: 0 });

    await reconcilePayments();
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('PENDING');
    expect((await reconcilePayments()).checked).toBe(0); // reconciledAt throttles repeat checks
  });
});

describe('completeEvents', () => {
  it('completes events only after the 6h grace period', async () => {
    const old = await seedEvent(5);
    const recent = await seedEvent(5);
    await prisma.event.update({ where: { id: old.event.id }, data: { startsAt: new Date(Date.now() - 30 * 3_600_000), endsAt: new Date(Date.now() - 7 * 3_600_000) } });
    await prisma.event.update({ where: { id: recent.event.id }, data: { startsAt: new Date(Date.now() - 4 * 3_600_000), endsAt: new Date(Date.now() - 3_600_000) } });

    expect((await completeEvents()).completed).toBe(1);
    expect((await prisma.event.findUniqueOrThrow({ where: { id: old.event.id } })).status).toBe('COMPLETED');
    expect((await prisma.event.findUniqueOrThrow({ where: { id: recent.event.id } })).status).toBe('PUBLISHED');
  });
});

describe('cleanup', () => {
  it('deletes only old, never-paid orders', async () => {
    const { event, category } = await seedEvent(5);
    const a = await seedAttendee();
    const mk = (status: 'EXPIRED' | 'PAID', ageDays: number) =>
      prisma.order.create({
        data: {
          attendeeId: a.id, eventId: event.id, status, totalMinor: 1, idempotencyKey: randomUUID(),
          expiresAt: new Date(), paidAt: status === 'PAID' ? new Date() : null,
          createdAt: new Date(Date.now() - ageDays * 864e5),
          items: { create: [{ categoryId: category.id, quantity: 1, unitPriceMinor: 1 }] },
        },
      });
    const oldExpired = await mk('EXPIRED', 40);
    const freshExpired = await mk('EXPIRED', 2);
    const oldPaid = await mk('PAID', 40);

    expect((await cleanup()).deletedOrders).toBe(1);
    const left = (await prisma.order.findMany()).map((o) => o.id);
    expect(left).not.toContain(oldExpired.id);
    expect(left).toEqual(expect.arrayContaining([freshExpired.id, oldPaid.id]));
  });
});