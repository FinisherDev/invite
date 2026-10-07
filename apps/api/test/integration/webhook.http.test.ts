import crypto, { randomUUID } from 'node:crypto';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app';
import { prisma } from '../../src/lib/prisma';
import { createOrder } from '../../src/modules/orders/order.service';
import { queueRefund } from '../../src/modules/refunds/refund.service';
import { seedAttendee, seedEvent, seedPaidOrder } from '../helpers/factories';

const api = request(buildApp());
const sign = (body: string) => crypto.createHmac('sha512', process.env.PAYSTACK_SECRET_KEY!).update(body).digest('hex');
const post = (body: string, signature?: string) => {
  const r = api.post('/webhooks/paystack').set('content-type', 'application/json');
  return (signature ? r.set('x-paystack-signature', signature) : r).send(body);
};

async function pending() {
  const { event, category } = await seedEvent(5);
  const a = await seedAttendee();
  const order = await createOrder(a.id, {
    eventId: event.id, idempotencyKey: randomUUID(), items: [{ categoryId: category.id, quantity: 2 }],
  });
  const body = JSON.stringify({ event: 'charge.success', data: { reference: order.paymentRef, amount: order.totalMinor } });
  return { order, body };
}

describe('POST /webhooks/paystack', () => {
  it('rejects missing, malformed and wrong signatures', async () => {
    const { body, order } = await pending();
    expect((await post(body)).status).toBe(401);
    expect((await post(body, 'short')).status).toBe(401);
    expect((await post(body, 'a'.repeat(128))).status).toBe(401);
    expect(await prisma.ticket.count({ where: { orderId: order.id } })).toBe(0);
  });

  it('rejects a validly signed body that is not JSON', async () => {
    const junk = 'not json';
    expect((await post(junk, sign(junk))).status).toBe(400);
  });

  it('issues tickets once even when delivered twice', async () => {
    const { body, order } = await pending();
    expect((await post(body, sign(body))).status).toBe(200);
    expect((await post(body, sign(body))).status).toBe(200);
    expect(await prisma.ticket.count({ where: { orderId: order.id } })).toBe(2);
  });

  it('finalizes a refund on refund.processed and ignores unknown events', async () => {
    const { order, attendee } = await seedPaidOrder(1);
    await queueRefund(order.id, { kind: 'attendee', attendeeId: attendee.id });
    const body = JSON.stringify({ event: 'refund.processed', data: { transaction_reference: order.paymentRef } });

    expect((await post(body, sign(body))).status).toBe(200);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('REFUNDED');

    const other = JSON.stringify({ event: 'something.else', data: {} });
    expect((await post(other, sign(other))).status).toBe(200);
  });
});