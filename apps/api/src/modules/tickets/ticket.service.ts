import { EventStatus, TicketStatus } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { Conflict, NotFound } from '../../lib/errors';

export async function checkIn(organizerId: string, eventId: string, code: string) {
  const event = await prisma.event.findFirst({ where: { id: eventId, organizerId }, select: { status: true } });
  if (!event) throw NotFound('Event');
  if (event.status !== EventStatus.PUBLISHED) throw Conflict('EVENT_NOT_ACTIVE', 'Check-in is only open for published events');

  // Atomic: two scanners hitting the same QR can't both succeed.
  const res = await prisma.ticket.updateMany({
    where: { code, eventId, status: TicketStatus.VALID },
    data: { status: TicketStatus.CHECKED_IN, checkedInAt: new Date() },
  });
  if (res.count === 1) {
    const t = await prisma.ticket.findUniqueOrThrow({
      where: { code },
      select: { category: { select: { name: true } }, attendee: { select: { fullName: true } } },
    });
    return { ok: true as const, category: t.category.name, attendeeName: t.attendee.fullName };
  }

  const ticket = await prisma.ticket.findUnique({ where: { code } });
  if (!ticket || ticket.eventId !== eventId) throw NotFound('Ticket');
  if (ticket.status === TicketStatus.CHECKED_IN)
    throw Conflict('ALREADY_CHECKED_IN', `Already used at ${ticket.checkedInAt?.toISOString()}`);
  throw Conflict('TICKET_VOID', 'Ticket is not valid');
}

export const listMyTickets = (attendeeId: string) =>
  prisma.ticket.findMany({
    where: { attendeeId },
    orderBy: { createdAt: 'desc' },
    take: 200,
    select: {
      id: true, code: true, status: true,
      event: { select: { id: true, title: true, venue: true, city: true, startsAt: true } },
      category: { select: { name: true } },
    },
  });