import { OrderStatus } from '@prisma/client';
import { logger } from '../lib/logger';
import { prisma } from '../lib/prisma';
import { paystack } from '../lib/paystack';
import { handleChargeSuccess } from '../modules/payments/payment.service';

/** Catches missed webhooks: asks Paystack about recently initialized checkouts that we still see as unpaid. */
export async function reconcilePayments(batchSize = 100) {
  const now = Date.now();
  const orders = await prisma.order.findMany({
    where: {
      status: { in: [OrderStatus.PENDING, OrderStatus.EXPIRED, OrderStatus.CANCELLED] },
      paymentInitializedAt: { gte: new Date(now - 24 * 3_600_000), lte: new Date(now - 2 * 60_000) },
      OR: [{ reconciledAt: null }, { reconciledAt: { lt: new Date(now - 10 * 60_000) } }],
    },
    select: { id: true, paymentRef: true },
    orderBy: { paymentInitializedAt: 'asc' },
    take: batchSize,
  });

  let recovered = 0;
  for (const o of orders) {
    try {
      const tx = await paystack.verify(o.paymentRef);
      if (tx.status === 'success') {
        const r = await handleChargeSuccess(o.paymentRef, tx.amountMinor);
        if (r.status !== 'ignored') recovered++;
      }
    } catch (err) {
      logger.warn({ err, orderId: o.id }, 'reconcile check failed');
    }
    await prisma.order.update({ where: { id: o.id }, data: { reconciledAt: new Date() } });
  }
  return { checked: orders.length, recovered };
}