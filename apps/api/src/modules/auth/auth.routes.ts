import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { attendeeRegisterSchema, loginSchema, organizerRegisterSchema } from '@invite/shared';
import { env } from '../../config/env';
import { currentUser, requireAuth } from '../../middleware/auth';
import * as auth from './auth.service';

export const authRouter = Router();

// Brute-force protection on credential endpoints.
authRouter.use(
  rateLimit({
    windowMs: 15 * 60_000,
    limit: 20,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip: () => env.NODE_ENV === 'test',
  }),
);

authRouter.post('/attendees/register', async (req, res) => {
  res.status(201).json(await auth.registerAttendee(attendeeRegisterSchema.parse(req.body)));
});
authRouter.post('/attendees/login', async (req, res) => {
  res.json(await auth.loginAttendee(loginSchema.parse(req.body)));
});
authRouter.post('/organizers/register', async (req, res) => {
  res.status(201).json(await auth.registerOrganizer(organizerRegisterSchema.parse(req.body)));
});
authRouter.post('/organizers/login', async (req, res) => {
  res.json(await auth.loginOrganizer(loginSchema.parse(req.body)));
});
authRouter.get('/me', requireAuth(), async (req, res) => {
  res.json(await auth.getProfile(currentUser(req)));
});