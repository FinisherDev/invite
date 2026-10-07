import { EventStatus } from '@prisma/client';
import { prisma } from '../lib/prisma';

export async function completeEvents() {
  const res = await prisma.event.updateMany({
    where: { status: EventStatus.PUBLISHED, endsAt: { lt: new Date(Date.now() - 6 * 3_600_000) } }, // grace for late check-ins
    data: { status: EventStatus.COMPLETED },
  });
  return { completed: res.count };
}