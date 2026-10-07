import { OrderStatus } from '@prisma/client';
import { prisma } from '../lib/prisma';

export async function cleanup() {
  const cutoff = new Date(Date.now() - 30 * 864e5);
  const orders = await prisma.order.deleteMany({
    where: { status: { in: [OrderStatus.EXPIRED, OrderStatus.CANCELLED] }, paidAt: null, createdAt: { lt: cutoff } },
  });
  return { deletedOrders: orders.count }; // items cascade
}