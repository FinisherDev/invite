import { afterAll, beforeEach } from 'vitest';
import { prisma } from '../src/lib/prisma';

const TABLES = ['Refund', 'Ticket', 'OrderItem', 'Order', 'TicketCategory', 'Event', 'Attendee', 'Organizer'];

beforeEach(async () => {
  if (!/test/i.test(process.env.DATABASE_URL ?? '')) throw new Error('Not a test database');
  await prisma.$executeRawUnsafe(`TRUNCATE ${TABLES.map((t) => `"${t}"`).join(',')} RESTART IDENTITY CASCADE`);
});
afterAll(() => prisma.$disconnect());