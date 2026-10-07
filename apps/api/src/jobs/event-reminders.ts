import { TicketStatus } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { notifier } from '../lib/notifier';

export async function sendEventReminders() {
  const from = new Date(Date.now() + 24 * 3_600_000);
  const to = new Date(Date.now() + 48 * 3_600_000);
  const tickets = await prisma.ticket.findMany({
    where: { status: TicketStatus.VALID, event: { status: 'PUBLISHED', startsAt: { gte: from, lt: to } } },
    distinct: ['attendeeId', 'eventId'],
    include: { attendee: { select: { email: true } }, event: { select: { title: true, startsAt: true } } },
  });
  for (const t of tickets)
    await notifier.send(t.attendee.email, `Reminder: ${t.event.title}`, `Your event starts ${t.event.startsAt.toISOString()}`);
  return { count: tickets.length };
}