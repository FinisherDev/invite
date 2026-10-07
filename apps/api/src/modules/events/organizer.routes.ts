import { Router } from 'express';
import {
  createCategorySchema, createEventSchema, pageQuery, updateCategorySchema, updateEventSchema,
} from '@invite/shared';
import { toPage, uuidParam } from '../../lib/http';
import { currentUser, requireAuth } from '../../middleware/auth';
import { checkIn } from '../tickets/ticket.service';
import { z } from 'zod';
import * as events from './event.service';

export const organizerRouter = Router();
organizerRouter.use(requireAuth('organizer'));

const me = (req: Parameters<typeof currentUser>[0]) => currentUser(req).sub;

organizerRouter.get('/events', async (req, res) => {
  res.json(await events.listOwnEvents(me(req)));
});
organizerRouter.post('/events', async (req, res) => {
  res.status(201).json(await events.createEvent(me(req), createEventSchema.parse(req.body)));
});
organizerRouter.patch('/events/:id', async (req, res) => {
  res.json(await events.updateEvent(me(req), uuidParam(req, 'id'), updateEventSchema.parse(req.body)));
});
organizerRouter.post('/events/:id/publish', async (req, res) => {
  res.json(await events.publishEvent(me(req), uuidParam(req, 'id')));
});
organizerRouter.post('/events/:id/cancel', async (req, res) => {
  res.json(await events.cancelEvent(me(req), uuidParam(req, 'id')));
});
organizerRouter.post('/events/:id/categories', async (req, res) => {
  res.status(201).json(await events.createCategory(me(req), uuidParam(req, 'id'), createCategorySchema.parse(req.body)));
});
organizerRouter.patch('/events/:id/categories/:categoryId', async (req, res) => {
  res.json(
    await events.updateCategory(
      me(req), uuidParam(req, 'id'), uuidParam(req, 'categoryId'), updateCategorySchema.parse(req.body),
    ),
  );
});
organizerRouter.get('/events/:id/summary', async (req, res) => {
  res.json(await events.getEventSummary(me(req), uuidParam(req, 'id')));
});
organizerRouter.get('/events/:id/tickets', async (req, res) => {
  const q = pageQuery.parse(req.query);
  res.json(toPage(await events.listEventTickets(me(req), uuidParam(req, 'id'), q), q.limit));
});
organizerRouter.post('/events/:id/check-in', async (req, res) => {
  const { code } = z.object({ code: z.string().min(8).max(64) }).parse(req.body);
  res.json(await checkIn(me(req), uuidParam(req, 'id'), code));
});