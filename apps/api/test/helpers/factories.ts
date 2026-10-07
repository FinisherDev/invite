import { randomUUID } from 'node:crypto';
import type { EventStatus } from '@prisma/client';
import { prisma } from '../../src/lib/prisma';
import { signToken, type Role } from '../../src/lib/jwt';
import { createOrder } from '../../src/modules/orders/order.service';
import { handleChargeSuccess } from '../../src/modules/payments/payment.service';

let n = 0;
const uniq = () => `${Date.now()}-${++n}`;
const DAY = 864e5;

export const seedOrganizer = () =>
  prisma.organizer.create({ data: { name: 'Org', email: `org-${uniq()}@test.io`, passwordHash: 'x' } });

export const seedAttendee = (_i = 0) =>
  prisma.attendee.create({ data: { email: `a-${uniq()}@test.io`, fullName: 'Attendee', passwordHash: 'x' } });

export async function seedEvent(
  capacity = 10,
  opts: { organizerId?: string; status?: EventStatus; startsInDays?: number } = {},
) {
  const organizer = opts.organizerId
    ? await prisma.organizer.findUniqueOrThrow({ where: { id: opts.organizerId } })
    : await seedOrganizer();
  const start = opts.startsInDays ?? 7;
  const event = await prisma.event.create({
    data: {
      organizerId: organizer.id, title: 'Lagos Live', description: 'd', venue: 'Eko Hotel', city: 'Lagos',
      startsAt: new Date(Date.now() + start * DAY), endsAt: new Date(Date.now() + (start + 1) * DAY),
      status: opts.status ?? 'PUBLISHED',
    },
  });
  const category = await prisma.ticketCategory.create({
    data: {
      eventId: event.id, name: 'Regular', priceMinor: 500_000, capacity, available: capacity,
      salesStartAt: new Date(Date.now() - DAY), salesEndAt: new Date(Date.now() + DAY),
    },
  });
  return { organizer, event, category };
}

export async function seedPaidOrder(quantity = 1, capacity = 10, startsInDays = 7) {
  const { event, category, organizer } = await seedEvent(capacity, { startsInDays });
  const attendee = await seedAttendee();
  const order = await createOrder(attendee.id, {
    eventId: event.id, idempotencyKey: randomUUID(), items: [{ categoryId: category.id, quantity }],
  });
  await handleChargeSuccess(order.paymentRef, order.totalMinor);
  return { event, category, organizer, attendee, order };
}

export const authHeader = (id: string, role: Role) => ({ Authorization: `Bearer ${signToken({ sub: id, role })}` });