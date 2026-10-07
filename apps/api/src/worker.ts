import { logger } from './lib/logger';
import { prisma } from './lib/prisma';
import { redis } from './lib/redis';
import { registerSchedules, scheduledQueue, startWorker } from './jobs/queue';

async function main() {
  await registerSchedules();
  const worker = startWorker();
  logger.info('worker started');

  const shutdown = async () => {
    await worker.close();
    await scheduledQueue.close();
    await redis.quit();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  logger.error({ err }, 'worker failed to start');
  process.exit(1);
});