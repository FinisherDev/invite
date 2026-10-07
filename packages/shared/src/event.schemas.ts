import { z } from 'zod';

const eventFields = z.object({
  title: z.string().trim().min(3).max(150),
  description: z.string().trim().min(1).max(5000),
  venue: z.string().trim().min(2).max(200),
  city: z.string().trim().min(2).max(80),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
});
const endsAfterStart = (v: { startsAt?: Date; endsAt?: Date }) =>
  !v.startsAt || !v.endsAt || v.endsAt > v.startsAt;

export const createEventSchema = eventFields.refine(endsAfterStart, {
  message: 'endsAt must be after startsAt',
  path: ['endsAt'],
});
export const updateEventSchema = eventFields
  .partial()
  .refine(endsAfterStart, { message: 'endsAt must be after startsAt', path: ['endsAt'] })
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' });

const categoryFields = z.object({
  name: z.string().trim().min(1).max(80),
  // Paystack rejects tiny amounts; free tickets need their own no-payment flow (not built yet).
  priceMinor: z.number().int().min(5_000).max(100_000_000),
  capacity: z.number().int().min(1).max(1_000_000),
  maxPerOrder: z.number().int().min(1).max(20).default(10),
  salesStartAt: z.coerce.date(),
  salesEndAt: z.coerce.date(),
});
const salesWindowOk = (v: { salesStartAt?: Date; salesEndAt?: Date }) =>
  !v.salesStartAt || !v.salesEndAt || v.salesEndAt > v.salesStartAt;

export const createCategorySchema = categoryFields.refine(salesWindowOk, {
  message: 'salesEndAt must be after salesStartAt',
  path: ['salesEndAt'],
});
export const updateCategorySchema = categoryFields
  .partial()
  .refine(salesWindowOk, { message: 'salesEndAt must be after salesStartAt', path: ['salesEndAt'] })
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' });

export type CreateEventInput = z.infer<typeof createEventSchema>;
export type UpdateEventInput = z.infer<typeof updateEventSchema>;
export type CreateCategoryInput = z.infer<typeof createCategorySchema>;
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;