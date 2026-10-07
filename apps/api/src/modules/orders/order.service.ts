import { OrderStatus, Prisma } from '@prisma/client';
import type { CreateOrderInput, PageQuery } from '@invite/shared';
import { env } from '../../config/env';
import { prisma } from '../../lib/prisma';
import { BadRequest, Conflict, NotFound, SoldOut } from '../../lib/errors';

const MAX_ORDER_TOTAL_MINOR = 2_000_000_000; // stay under Postgres INT4 (2.147bn)

export async function createOrder(attendeeId: string, input: CreateOrderInput) {
  const lookup = { attendeeId_idempotencyKey: { attendeeId, idempotencyKey: input.idempotencyKey } };

  // Idempotency: a retried request returns the original order.
  const existing = await prisma.order.findUnique({ where: lookup, include: { items: true } });
  if (existing) return existing;

  // Anti-hoarding: cap concurrent unpaid reservations per attendee.
  const pending = await prisma.order.count({
    where: { attendeeId, status: OrderStatus.PENDING, expiresAt: { gt: new Date() } },
  });
  if (pending >= env.MAX_PENDING_ORDERS_PER_ATTENDEE)
    throw Conflict('TOO_MANY_PENDING', 'Pay for or cancel your pending orders first');

  // Merge duplicate categories; sort by id so concurrent transactions lock rows in the same order.
  const merged = new Map<string, number>();
  for (const i of input.items) merged.set(i.categoryId, (merged.get(i.categoryId) ?? 0) + i.quantity);
  const lines = [...merged.entries()].sort(([a], [b]) => a.localeCompare(b));

  try {
    return await prisma.$transaction(
      async (tx) => {
        const event = await tx.event.findUnique({ where: { id: input.eventId } });
        if (!event || event.status !== 'PUBLISHED') throw NotFound('Event');

        const categories = await tx.ticketCategory.findMany({
          where: { id: { in: lines.map(([id]) => id) }, eventId: input.eventId },
        });
        if (categories.length !== lines.length) throw BadRequest('Invalid ticket category');

        const now = new Date();
        let total = 0;
        const items: Prisma.OrderItemCreateWithoutOrderInput[] = [];

        for (const [categoryId, quantity] of lines) {
          const cat = categories.find((c) => c.id === categoryId)!;
          if (now < cat.salesStartAt || now > cat.salesEndAt) throw BadRequest(`"${cat.name}" is not on sale`);
          if (quantity > cat.maxPerOrder) throw BadRequest(`Max ${cat.maxPerOrder} of "${cat.name}" per order`);

          // Atomic reservation: succeeds only if enough stock remains.
          const res = await tx.ticketCategory.updateMany({
            where: { id: categoryId, available: { gte: quantity } },
            data: { available: { decrement: quantity } },
          });
          if (res.count === 0) throw SoldOut(cat.name);

          total += cat.priceMinor * quantity;
          if (total > MAX_ORDER_TOTAL_MINOR) throw BadRequest('Order total is too large');
          items.push({ category: { connect: { id: categoryId } }, quantity, unitPriceMinor: cat.priceMinor });
        }

        return tx.order.create({
          data: {
            attendee: { connect: { id: attendeeId } },
            event: { connect: { id: input.eventId } },
            idempotencyKey: input.idempotencyKey,
            totalMinor: total,
            currency: categories[0].currency,
            expiresAt: new Date(Date.now() + env.ORDER_TTL_MINUTES * 60_000),
            items: { create: items },
          },
          include: { items: true },
        });
      },
      { timeout: 10_000 },
    );
  } catch (e) {
    // Two identical requests raced past the idempotency check: return the winner's order.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')
      return prisma.order.findUniqueOrThrow({ where: lookup, include: { items: true } });
    throw e;
  }
}

/** Compare-and-swap PENDING -> target, then give the stock back. Safe to call repeatedly and concurrently. */
async function release(orderId: string, target: 'EXPIRED' | 'CANCELLED', guard: Prisma.OrderWhereInput = {}) {
  return prisma.$transaction(async (tx) => {
    const res = await tx.order.updateMany({
      where: { id: orderId, status: OrderStatus.PENDING, ...guard },
      data: { status: target },
    });
    if (res.count === 0) return false;

    const items = await tx.orderItem.findMany({ where: { orderId }, orderBy: { categoryId: 'asc' } });
    for (const item of items) {
      await tx.ticketCategory.update({
        where: { id: item.categoryId },
        data: { available: { increment: item.quantity } },
      });
    }
    return true;
  });
}

export const expireOrder = (orderId: string) => release(orderId, 'EXPIRED', { expiresAt: { lt: new Date() } });

export async function cancelOrder(attendeeId: string, orderId: string) {
  if (!(await release(orderId, 'CANCELLED', { attendeeId }))) throw NotFound('Pending order');
  return { status: 'CANCELLED' as const };
}

export async function getOrder(attendeeId: string, id: string) {
  const order = await prisma.order.findFirst({
    where: { id, attendeeId },
    include: { items: true, tickets: { select: { id: true, code: true, status: true, categoryId: true } }, refund: true },
  });
  if (!order) throw NotFound('Order');
  return order;
}

export const listOrders = (attendeeId: string, { cursor, limit }: PageQuery) =>
  prisma.order.findMany({
    where: { attendeeId },
    orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
    take: limit,
    ...(cursor && { skip: 1, cursor: { id: cursor } }),
    include: { items: true, event: { select: { title: true, startsAt: true } } },
  });