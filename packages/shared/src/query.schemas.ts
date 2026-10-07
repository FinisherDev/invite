import { z } from 'zod';

export const pageQuery = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export const listEventsQuery = pageQuery.extend({ city: z.string().trim().min(1).max(80).optional() });
export type PageQuery = z.infer<typeof pageQuery>;
export type ListEventsQuery = z.infer<typeof listEventsQuery>;