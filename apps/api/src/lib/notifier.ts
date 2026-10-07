import { logger } from './logger';

export interface Notifier {
  send(to: string, subject: string, body: string): Promise<void>;
}
export const notifier: Notifier = {
  async send(to, subject) {
    logger.info({ to, subject }, 'notification (stub)');
  },
};