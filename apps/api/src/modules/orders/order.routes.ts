import { Router } from 'express';
import { createOrderSchema, pageQuery } from '@invite/shared';
import { toPage, uuidParam } from '../../lib/http';
import { currentUser, requireAuth } from '../../middleware/auth';
import { initializePayment } from '../payments/payment.service';
import { queueRefund } from '../refunds/refund.service';
import { cancelOrder, createOrder, getOrder, listOrders } from './order.service';

export const orderRouter = Router();
orderRouter.use(requireAuth('attendee'));

const me = (req: Parameters<typeof currentUser>[0]) => currentUser(req).sub;

orderRouter.post('/', async (req, res) => {
  res.status(201).json(await createOrder(me(req), createOrderSchema.parse(req.body)));
});
orderRouter.get('/', async (req, res) => {
  const q = pageQuery.parse(req.query);
  res.json(toPage(await listOrders(me(req), q), q.limit));
});
orderRouter.get('/:id', async (req, res) => {
  res.json(await getOrder(me(req), uuidParam(req, 'id')));
});
orderRouter.post('/:id/pay', async (req, res) => {
  res.json(await initializePayment(uuidParam(req, 'id'), me(req)));
});
orderRouter.post('/:id/cancel', async (req, res) => {
  res.json(await cancelOrder(me(req), uuidParam(req, 'id')));
});
orderRouter.post('/:id/refund', async (req, res) => {
  // 202: the refund is recorded now and sent to the provider by the process-refunds job.
  res.status(202).json(await queueRefund(uuidParam(req, 'id'), { kind: 'attendee', attendeeId: me(req) }));
});