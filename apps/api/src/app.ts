import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import pinoHttp from 'pino-http';
import { env } from './config/env';
import { logger } from './lib/logger';
import { prisma } from './lib/prisma';
import { errorHandler, notFoundHandler } from './middleware/error-handler';
import { authRouter } from './modules/auth/auth.routes';
import { eventRouter } from './modules/events/event.routes';
import { organizerRouter } from './modules/events/organizer.routes';
import { orderRouter } from './modules/orders/order.routes';
import { webhookRouter } from './modules/payments/payment.routes';
import { meRouter } from './modules/tickets/ticket.routes';

export function buildApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1); // behind a platform proxy, so rate limits see the real client IP
  app.use(helmet());
  app.use(cors({ origin: env.CORS_ORIGINS.length ? env.CORS_ORIGINS : false }));
  app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url === '/health' } }));

  app.get('/health', (_req, res) => {
    res.json({ ok: true });
  });
  app.get('/health/ready', async (_req, res) => {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ ok: true });
  });

  // Webhooks are mounted BEFORE express.json(): signature checks need the untouched raw body.
  app.use('/webhooks', webhookRouter);

  app.use(express.json({ limit: '100kb' }));
  app.use(
    rateLimit({
      windowMs: 60_000,
      limit: 300,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      skip: () => env.NODE_ENV === 'test',
    }),
  );

  app.use('/auth', authRouter);
  app.use('/events', eventRouter);
  app.use('/orders', orderRouter);
  app.use('/me', meRouter);
  app.use('/organizer', organizerRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}