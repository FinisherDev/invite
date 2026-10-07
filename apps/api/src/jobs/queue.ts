import { Queue, Worker } from 'bullmq';
import { logger } from '../lib/logger';
import { redis } from '../lib/redis';
import { cleanup } from './cleanup';
import { completeEvents } from './complete-events';
import { sendEventReminders } from './event-reminders';
import { expireStaleOrders } from './expire-orders';
import { submitPendingRefundsJob } from './process-refunds';
import { reconcilePayments } from './reconcile-payments';
import { refundCancelledEventsJob } from './refund-cancelled-events';

const QUEUE = 'scheduled';
export const scheduledQueue = new Queue(QUEUE, {
  connection: redis,
  defaultJobOptions: { removeOnComplete: 100, removeOnFail: 500, attempts: 1 },
});

const handlers: Record<string, () => Promise<unknown>> = {
  'expire-orders': expireStaleOrders,
  'process-refunds': submitPendingRefundsJob,
  'reconcile-payments': reconcilePayments,
  'refund-cancelled-events': refundCancelledEventsJob,
  'complete-events': completeEvents,
  'event-reminders': sendEventReminders,
  cleanup,
};

const schedule = (name: string, repeat: { every: number } | { pattern: string; tz: string }) =>
  scheduledQueue.upsertJobScheduler(name, repeat, { name });

export async function registerSchedules() {
  await schedule('expire-orders', { every: 60_000 });
  await schedule('process-refunds', { every: 60_000 });
  await schedule('reconcile-payments', { every: 5 * 60_000 });
  await schedule('refund-cancelled-events', { every: 5 * 60_000 });
  await schedule('complete-events', { every: 10 * 60_000 });
  await schedule('event-reminders', { pattern: '0 8 * * *', tz: 'Africa/Lagos' });
  await schedule('cleanup', { pattern: '0 3 * * *', tz: 'Africa/Lagos' });
}

export function startWorker() {
  const worker = new Worker(
    QUEUE,
    async (job) => {
      const handler = handlers[job.name];
      if (!handler) throw new Error(`No handler for job "${job.name}"`);
      return handler();
    },
    { connection: redis, concurrency: 1 },
  );
  worker.on('completed', (job, result) => logger.info({ job: job.name, result }, 'job done'));
  worker.on('failed', (job, err) => logger.error({ job: job?.name, err }, 'job failed'));
  return worker;
}