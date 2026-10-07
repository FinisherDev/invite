import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  JWT_SECRET: z.string().min(32),
  JWT_EXPIRES_IN: z.string().default('7d'),
  PAYSTACK_SECRET_KEY: z.string().min(1),
  PAYSTACK_BASE_URL: z.string().url().default('https://api.paystack.co'), // point at a mock for load tests
  ORDER_TTL_MINUTES: z.coerce.number().default(10),
  REFUND_CUTOFF_HOURS: z.coerce.number().default(48),
  MAX_PENDING_ORDERS_PER_ATTENDEE: z.coerce.number().default(3),
  BCRYPT_ROUNDS: z.coerce.number().min(4).max(15).default(12),
  CORS_ORIGINS: z
    .string()
    .default('')
    .transform((s) => s.split(',').map((x) => x.trim()).filter(Boolean)),
  RUN_JOBS_IN_API: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
});

export const env = schema.parse(process.env);