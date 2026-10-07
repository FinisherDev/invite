import { Router } from 'express';
import { currentUser, requireAuth } from '../../middleware/auth';
import { listMyTickets } from './ticket.service';

export const meRouter = Router();
meRouter.use(requireAuth('attendee'));

meRouter.get('/tickets', async (req, res) => {
  res.json(await listMyTickets(currentUser(req).sub));
});