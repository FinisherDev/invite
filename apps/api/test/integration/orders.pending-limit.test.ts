import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { createOrder, cancelOrder } from '../../src/modules/orders/order.service';
import { seedAttendee, seedEvent } from '../helpers/factories';

it('caps unpaid orders per attendee, and cancelling frees a slot and the stock', async () => {
  const { event, category } = await seedEvent(20);
  const a = await seedAttendee();
  const buy = () => createOrder(a.id, { eventId: event.id, idempotencyKey: randomUUID(), items: [{ categoryId: category.id, quantity: 1 }] });

  const first = await buy();
  await buy();
  await buy();
  await expect(buy()).rejects.toMatchObject({ code: 'TOO_MANY_PENDING' });

  await cancelOrder(a.id, first.id);
  await expect(buy()).resolves.toBeTruthy();
});