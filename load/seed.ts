import { writeFileSync } from 'node:fs';
import { prisma } from '../apps/api/src/lib/prisma';
import { signToken } from '../apps/api/src/lib/jwt';

const COUNT = Number(process.env.ATTENDEES ?? 10_000);
const DAY = 864e5;

async function main() {
  const org = await prisma.organizer.create({ data: { name: 'Load Org', email: `load-${Date.now()}@test.io`, passwordHash: 'x' } });
  const event = await prisma.event.create({
    data: {
      organizerId: org.id, title: 'Load Test Live', description: 'd', venue: 'v', city: 'Lagos',
      startsAt: new Date(Date.now() + 7 * DAY), endsAt: new Date(Date.now() + 8 * DAY), status: 'PUBLISHED',
    },
  });
  const specs = [{ name: 'General', capacity: 5000 }, { name: 'VIP', capacity: 1000 }, { name: 'Backstage', capacity: 100 }];
  const categories = [];
  for (const s of specs)
    categories.push(await prisma.ticketCategory.create({
      data: { eventId: event.id, name: s.name, priceMinor: 500_000, capacity: s.capacity, available: s.capacity,
              salesStartAt: new Date(Date.now() - DAY), salesEndAt: new Date(Date.now() + DAY) },
    }));

  await prisma.attendee.createMany({
    data: Array.from({ length: COUNT }, (_, i) => ({ email: `load-${i}@test.io`, fullName: `Load ${i}`, passwordHash: 'x' })),
    skipDuplicates: true,
  });
  const attendees = await prisma.attendee.findMany({ where: { email: { startsWith: 'load-' } }, select: { id: true }, take: COUNT });
  writeFileSync('load/tokens.json', JSON.stringify(attendees.map((a: any) => signToken({ sub: a.id, role: 'attendee' }))));
  console.log({ EVENT_ID: event.id, CATEGORY_IDS: categories.map((c) => ({ name: c.name, id: c.id })) });
  await prisma.$disconnect();
}
main();