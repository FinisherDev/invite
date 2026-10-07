import { z } from 'zod';

export const createOrderSchema = z.object({
  eventId: z.string().uuid(),
  idempotencyKey: z.string().min(8).max(100),
  items: z
    .array(z.object({ categoryId: z.string().uuid(), quantity: z.number().int().min(1).max(20) }))
    .min(1)
    .max(5),
});
export type CreateOrderInput = z.infer<typeof createOrderSchema>;