import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { prisma } from '../../src/lib/prisma';
import { createOrder, expireOrder } from '../../src/modules/orders/order.service';
import { handleChargeSuccess } from '../../src/modules/payments/payment.service';
import { seedAttendee, seedEvent } from '../helpers/factories';

async function expiredOrder(quantity = 2, capacity = 5) {
  const { event, category } = await seedEvent(capacity);
  const attendee = await seedAttendee();
  const order = await createOrder(attendee.id, {
    eventId: event.id, idempotencyKey: randomUUID(), items: [{ categoryId: category.id, quantity }],
  });
  await prisma.order.update({ where: { id: order.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
  await expireOrder(order.id);
  return { order, category, event };
}
const stock = async (id: string) => (await prisma.ticketCategory.findUniqueOrThrow({ where: { id } })).available;

describe('handleChargeSuccess edge cases', () => {
  it('rejects a wrong paid amount without issuing tickets', async () => {
    const { event, category } = await seedEvent(5);
    const a = await seedAttendee();
    const order = await createOrder(a.id, {
      eventId: event.id, idempotencyKey: randomUUID(), items: [{ categoryId: category.id, quantity: 2 }],
    });
    const r = await handleChargeSuccess(order.paymentRef, order.totalMinor - 1);
    expect(r.status).toBe('amount_mismatch');
    expect(await prisma.ticket.count({ where: { orderId: order.id } })).toBe(0);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('PENDING');
  });

  it('reinstates a late payment when stock is still available', async () => {
    const { order, category } = await expiredOrder(2, 5);
    expect(await stock(category.id)).toBe(5);

    const r = await handleChargeSuccess(order.paymentRef, order.totalMinor);

    expect(r.status).toBe('reinstated');
    expect(await prisma.ticket.count({ where: { orderId: order.id } })).toBe(2);
    expect(await stock(category.id)).toBe(3);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('PAID');
  });

  it('queues a refund when a late payment finds the stock gone', async () => {
    const { order, category } = await expiredOrder(2, 2);
    await prisma.ticketCategory.update({ where: { id: category.id }, data: { available: 0 } }); // someone else bought it

    const r = await handleChargeSuccess(order.paymentRef, order.totalMinor);

    expect(r.status).toBe('refund_queued');
    expect(await prisma.ticket.count({ where: { orderId: order.id } })).toBe(0);
    expect(await stock(category.id)).toBe(0);
    const refund = await prisma.refund.findUniqueOrThrow({ where: { orderId: order.id } });
    expect(refund).toMatchObject({ reason: 'LATE_PAYMENT', status: 'PENDING', restock: false });
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('REFUND_PENDING');
  });

  it('handles duplicate late-payment deliveries exactly once', async () => {
    const { order, category } = await expiredOrder(2, 5);
    await Promise.all([
      handleChargeSuccess(order.paymentRef, order.totalMinor),
      handleChargeSuccess(order.paymentRef, order.totalMinor),
    ]);
    expect(await prisma.ticket.count({ where: { orderId: order.id } })).toBe(2);
    expect(await stock(category.id)).toBe(3); // stock taken once, not twice
  });

  it('ignores unknown references', async () => {
    expect((await handleChargeSuccess('nope', 100)).status).toBe('ignored');
  });
});