import { EventStatus, Prisma } from '@prisma/client';
import type {
  CreateCategoryInput, CreateEventInput, ListEventsQuery, PageQuery,
  UpdateCategoryInput, UpdateEventInput,
} from '@invite/shared';
import { prisma } from '../../lib/prisma';
import { BadRequest, Conflict, NotFound } from '../../lib/errors';

// ---------- public ----------
const publicCategory = {
  id: true, name: true, priceMinor: true, currency: true, available: true,
  maxPerOrder: true, salesStartAt: true, salesEndAt: true,
} satisfies Prisma.TicketCategorySelect;

const publicEvent = {
  id: true, title: true, description: true, venue: true, city: true, startsAt: true, endsAt: true,
  organizer: { select: { name: true } },
  categories: { select: publicCategory, orderBy: { priceMinor: 'asc' } },
} satisfies Prisma.EventSelect;

export function listPublishedEvents({ city, cursor, limit }: ListEventsQuery) {
  return prisma.event.findMany({
    where: {
      status: EventStatus.PUBLISHED,
      endsAt: { gte: new Date() },
      ...(city && { city: { equals: city, mode: 'insensitive' } }),
    },
    orderBy: [{ startsAt: 'asc' }, { id: 'asc' }], // stable order for cursor paging
    take: limit,
    ...(cursor && { skip: 1, cursor: { id: cursor } }),
    select: publicEvent,
  });
}

export async function getPublishedEvent(id: string) {
  const event = await prisma.event.findFirst({
    where: { id, status: EventStatus.PUBLISHED },
    select: publicEvent,
  });
  if (!event) throw NotFound('Event');
  return event;
}

// ---------- organizer ----------
const EDITABLE: EventStatus[] = [EventStatus.DRAFT, EventStatus.PUBLISHED];

// 404 (not 403) for other people's events, so IDs can't be probed.
async function ownEvent(organizerId: string, eventId: string) {
  const event = await prisma.event.findFirst({ where: { id: eventId, organizerId } });
  if (!event) throw NotFound('Event');
  return event;
}
const assertEditable = (status: EventStatus) => {
  if (!EDITABLE.includes(status)) throw Conflict('EVENT_LOCKED', `A ${status.toLowerCase()} event can't be edited`);
};

export const listOwnEvents = (organizerId: string) =>
  prisma.event.findMany({
    where: { organizerId },
    orderBy: { startsAt: 'desc' },
    take: 100,
    include: { _count: { select: { categories: true, tickets: true } } },
  });

export const createEvent = (organizerId: string, input: CreateEventInput) =>
  prisma.event.create({ data: { ...input, organizerId } });

export async function updateEvent(organizerId: string, eventId: string, input: UpdateEventInput) {
  const event = await ownEvent(organizerId, eventId);
  assertEditable(event.status);
  const startsAt = input.startsAt ?? event.startsAt;
  const endsAt = input.endsAt ?? event.endsAt;
  if (endsAt <= startsAt) throw BadRequest('endsAt must be after startsAt');
  return prisma.event.update({ where: { id: eventId }, data: input });
}

export async function publishEvent(organizerId: string, eventId: string) {
  const event = await ownEvent(organizerId, eventId);
  if (event.status !== EventStatus.DRAFT) throw Conflict('INVALID_STATE', 'Only draft events can be published');
  if (event.startsAt <= new Date()) throw BadRequest('The event start is in the past');
  if ((await prisma.ticketCategory.count({ where: { eventId } })) === 0)
    throw Conflict('NO_CATEGORIES', 'Add at least one ticket category first');
  await prisma.event.updateMany({ where: { id: eventId, status: EventStatus.DRAFT }, data: { status: EventStatus.PUBLISHED } });
  return prisma.event.findUniqueOrThrow({ where: { id: eventId } });
}

/** Marks the event cancelled. The refund-cancelled-events cron then refunds paid orders in batches. */
export async function cancelEvent(organizerId: string, eventId: string) {
  await ownEvent(organizerId, eventId);
  const res = await prisma.event.updateMany({
    where: { id: eventId, organizerId, status: { in: EDITABLE }, endsAt: { gt: new Date() } },
    data: { status: EventStatus.CANCELLED },
  });
  if (res.count === 0) throw Conflict('INVALID_STATE', 'This event can no longer be cancelled');
  return { status: EventStatus.CANCELLED, note: 'Refunds for paid orders are queued and processed within minutes' };
}

export async function createCategory(organizerId: string, eventId: string, input: CreateCategoryInput) {
  const event = await ownEvent(organizerId, eventId);
  assertEditable(event.status);
  if (input.salesEndAt > event.endsAt) throw BadRequest('Sales must end before the event ends');
  try {
    return await prisma.ticketCategory.create({ data: { ...input, eventId, available: input.capacity } });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')
      throw Conflict('CATEGORY_EXISTS', 'A category with that name already exists');
    throw e;
  }
}

export async function updateCategory(
  organizerId: string, eventId: string, categoryId: string, input: UpdateCategoryInput,
) {
  const event = await ownEvent(organizerId, eventId);
  assertEditable(event.status);
  const cat = await prisma.ticketCategory.findFirst({ where: { id: categoryId, eventId } });
  if (!cat) throw NotFound('Ticket category');

  const { capacity, ...rest } = input;
  const start = rest.salesStartAt ?? cat.salesStartAt;
  const end = rest.salesEndAt ?? cat.salesEndAt;
  if (end <= start) throw BadRequest('salesEndAt must be after salesStartAt');
  if (end > event.endsAt) throw BadRequest('Sales must end before the event ends');

  await prisma.$transaction(async (tx: any) => {
    if (Object.keys(rest).length) await tx.ticketCategory.update({ where: { id: categoryId }, data: rest });
    if (capacity !== undefined) {
      // Shift `available` by the capacity delta, atomically, refusing to go below what's already sold/reserved.
      const changed = await tx.$executeRaw`
        UPDATE "TicketCategory"
        SET capacity = ${capacity}::int, available = available + (${capacity}::int - capacity)
        WHERE id = ${categoryId} AND available + (${capacity}::int - capacity) >= 0`;
      if (changed === 0) throw BadRequest('Capacity cannot be lower than tickets already sold or reserved');
    }
  });
  return prisma.ticketCategory.findUniqueOrThrow({ where: { id: categoryId } });
}

export async function getEventSummary(organizerId: string, eventId: string) {
  await ownEvent(organizerId, eventId);
  const [categories, [totals], tickets] = await Promise.all([
    prisma.ticketCategory.findMany({
      where: { eventId },
      select: { id: true, name: true, priceMinor: true, capacity: true, available: true },
      orderBy: { name: 'asc' },
    }),
    // Raw bigint sum: revenue in kobo can exceed a 32-bit int.
    prisma.$queryRaw<{ revenue: bigint; orders: bigint }[]>`
      SELECT COALESCE(SUM("totalMinor"), 0)::bigint AS revenue, COUNT(*)::bigint AS orders
      FROM "Order" WHERE "eventId" = ${eventId} AND status = 'PAID'`,
    prisma.ticket.groupBy({ by: ['status'], where: { eventId }, _count: { _all: true } }),
  ]);
  return {
    categories: categories.map((c: any) => ({ ...c, reserved: c.capacity - c.available })),
    paidOrders: Number(totals.orders),
    revenueMinor: Number(totals.revenue),
    tickets: Object.fromEntries(tickets.map((t: any) => [t.status, t._count._all])),
  };
}

export async function listEventTickets(organizerId: string, eventId: string, { cursor, limit }: PageQuery) {
  await ownEvent(organizerId, eventId);
  return prisma.ticket.findMany({
    where: { eventId },
    orderBy: { id: 'asc' },
    take: limit,
    ...(cursor && { skip: 1, cursor: { id: cursor } }),
    select: {
      id: true, status: true, checkedInAt: true,
      category: { select: { name: true } },
      attendee: { select: { fullName: true, email: true } },
    },
  });
}