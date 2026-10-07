import type { ErrorRequestHandler, RequestHandler } from 'express';
import { Prisma } from '@prisma/client';
import { AppError, NotFound } from '../lib/errors';
import { logger } from '../lib/logger';

export const notFoundHandler: RequestHandler = (_req, _res, next) => next(NotFound('Route'));

// Structural check: works even if `zod` is installed twice (shared package vs api).
const isZodError = (e: unknown): e is { issues: unknown[] } =>
  typeof e === 'object' && e !== null &&
  (e as { name?: string }).name === 'ZodError' &&
  Array.isArray((e as { issues?: unknown }).issues);

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({ code: err.code, message: err.message });
    return;
  }
  if (isZodError(err)) {
    res.status(422).json({ code: 'VALIDATION', issues: err.issues });
    return;
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
    res.status(404).json({ code: 'NOT_FOUND', message: 'Record not found' });
    return;
  }
  const status = (err as { status?: number }).status; // body-parser errors (bad JSON, too large)
  if (typeof status === 'number' && status >= 400 && status < 500) {
    res.status(status).json({ code: 'BAD_REQUEST', message: 'Malformed request' });
    return;
  }
  logger.error({ err }, 'unhandled error');
  res.status(500).json({ code: 'INTERNAL', message: 'Something went wrong' });
};