import { OrderStatus } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { expireOrder } from '../modules/orders/order.service';

export async function expireStaleOrders(batchSize = 200, maxBatches = 50) {
  let released = 0;
  for (let i = 0; i < maxBatches; i++) {
    const stale = await prisma.order.findMany({
      where: { status: OrderStatus.PENDING, expiresAt: { lt: new Date() } },
      select: { id: true },
      take: batchSize,
    });
    if (stale.length === 0) break;
    let releasedThisBatch = 0;
    for (const { id } of stale) if (await expireOrder(id)) releasedThisBatch++;
    released += releasedThisBatch;
    if (releasedThisBatch === 0) break; // someone else is draining them; don't spin
  }
  return { released };
}