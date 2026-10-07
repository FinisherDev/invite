import { describe, expect, it } from 'vitest';
import { prisma } from '../../src/lib/prisma';
import { checkIn } from '../../src/modules/tickets/ticket.service';
import { queueRefund } from '../../src/modules/refunds/refund.service';
import { seedOrganizer, seedPaidOrder } from '../helpers/factories';

const firstTicket = (orderId: string) => prisma.ticket.findFirstOrThrow({ where: { orderId } });

describe('checkIn', () => {
  it('lets exactly one of many simultaneous scans succeed', async () => {
    const { event, organizer, order } = await seedPaidOrder(1);
    const t = await firstTicket(order.id);
    const results = await Promise.allSettled(Array.from({ length: 10 }, () => checkIn(organizer.id, event.id, t.code)));

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(rejected.every((r) => r.reason.code === 'ALREADY_CHECKED_IN')).toBe(true);
  });

  it("refuses another organizer's event (404, no leak)", async () => {
    const { event, order } = await seedPaidOrder(1);
    const t = await firstTicket(order.id);
    const stranger = await seedOrganizer();
    await expect(checkIn(stranger.id, event.id, t.code)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect((await firstTicket(order.id)).status).toBe('VALID');
  });

  it('rejects unknown codes and voided tickets', async () => {
    const { event, organizer, attendee, order } = await seedPaidOrder(1);
    await expect(checkIn(organizer.id, event.id, 'does-not-exist')).rejects.toMatchObject({ code: 'NOT_FOUND' });

    const t = await firstTicket(order.id);
    await queueRefund(order.id, { kind: 'attendee', attendeeId: attendee.id });
    await expect(checkIn(organizer.id, event.id, t.code)).rejects.toMatchObject({ code: 'TICKET_VOID' });
  });
});