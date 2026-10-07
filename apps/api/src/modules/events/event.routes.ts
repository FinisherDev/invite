import { Router } from 'express';
import { listEventsQuery } from '@invite/shared';
import { toPage, uuidParam } from '../../lib/http';
import { getPublishedEvent, listPublishedEvents } from './event.service';

export const eventRouter = Router();

eventRouter.get('/', async (req, res) => {
  const q = listEventsQuery.parse(req.query);
  res.json(toPage(await listPublishedEvents(q), q.limit));
});
eventRouter.get('/:id', async (req, res) => {
  res.json(await getPublishedEvent(uuidParam(req, 'id')));
});