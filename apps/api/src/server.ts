import { buildApp } from './app';
import { env } from './config/env';
import { logger } from './lib/logger';
import { prisma } from './lib/prisma';
import type { Worker } from 'bullmq';

async function main() {
  const app = buildApp();
  const server = app.listen(env.PORT, '0.0.0.0', () => logger.info(`API listening on :${env.PORT}`));

  // Small deployments: run the cron worker inside the API process. Bigger ones: run worker.ts separately.
  let worker: Worker | undefined;
  if (env.RUN_JOBS_IN_API) {
    const { registerSchedules, startWorker } = await import('./jobs/queue'); // lazy: only connects to Redis if needed
    await registerSchedules();
    worker = startWorker();
  }

  const shutdown = async () => {
    server.close();
    await worker?.close();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  logger.error({ err }, 'failed to start');
  process.exit(1);
});