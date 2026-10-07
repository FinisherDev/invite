import { z } from 'zod';

const email = z.string().trim().toLowerCase().email();
const password = z.string().min(8).max(72); // bcrypt only uses the first 72 bytes

export const attendeeRegisterSchema = z.object({
  email,
  password,
  fullName: z.string().trim().min(2).max(100),
  phone: z.string().trim().min(7).max(20).optional(),
});
export const organizerRegisterSchema = z.object({
  email,
  password,
  name: z.string().trim().min(2).max(100),
});
export const loginSchema = z.object({ email, password: z.string().min(1).max(72) });

export type AttendeeRegisterInput = z.infer<typeof attendeeRegisterSchema>;
export type OrganizerRegisterInput = z.infer<typeof organizerRegisterSchema>;
export type LoginInput = z.infer<typeof loginSchema>;