import bcrypt from 'bcryptjs';
import { Prisma } from '@prisma/client';
import type { AttendeeRegisterInput, LoginInput, OrganizerRegisterInput } from '@invite/shared';
import { env } from '../../config/env';
import { prisma } from '../../lib/prisma';
import { Conflict, NotFound, Unauthorized } from '../../lib/errors';
import { signToken, type AuthUser } from '../../lib/jwt';

// Compared against when the email is unknown, so response time doesn't reveal which emails exist.
const DUMMY_HASH = bcrypt.hashSync('dummy-password', env.BCRYPT_ROUNDS);

async function checkPassword(user: { passwordHash: string } | null, password: string) {
  const ok = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !ok) throw Unauthorized('Invalid email or password');
}

const duplicate = (e: unknown) =>
  e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002'
    ? Conflict('EMAIL_TAKEN', 'Email already registered')
    : e;

export async function registerAttendee(input: AttendeeRegisterInput) {
  const passwordHash = await bcrypt.hash(input.password, env.BCRYPT_ROUNDS);
  try {
    const attendee = await prisma.attendee.create({
      data: { email: input.email, fullName: input.fullName, phone: input.phone, passwordHash },
      select: { id: true, email: true, fullName: true },
    });
    return { token: signToken({ sub: attendee.id, role: 'attendee' }), attendee };
  } catch (e) {
    throw duplicate(e);
  }
}

export async function loginAttendee(input: LoginInput) {
  const user = await prisma.attendee.findUnique({ where: { email: input.email } });
  await checkPassword(user, input.password);
  return {
    token: signToken({ sub: user!.id, role: 'attendee' }),
    attendee: { id: user!.id, email: user!.email, fullName: user!.fullName },
  };
}

export async function registerOrganizer(input: OrganizerRegisterInput) {
  const passwordHash = await bcrypt.hash(input.password, env.BCRYPT_ROUNDS);
  try {
    const organizer = await prisma.organizer.create({
      data: { email: input.email, name: input.name, passwordHash },
      select: { id: true, email: true, name: true },
    });
    return { token: signToken({ sub: organizer.id, role: 'organizer' }), organizer };
  } catch (e) {
    throw duplicate(e);
  }
}

export async function loginOrganizer(input: LoginInput) {
  const user = await prisma.organizer.findUnique({ where: { email: input.email } });
  await checkPassword(user, input.password);
  return {
    token: signToken({ sub: user!.id, role: 'organizer' }),
    organizer: { id: user!.id, email: user!.email, name: user!.name },
  };
}

export async function getProfile(auth: AuthUser) {
  const profile =
    auth.role === 'attendee'
      ? await prisma.attendee.findUnique({ where: { id: auth.sub }, select: { id: true, email: true, fullName: true, phone: true } })
      : await prisma.organizer.findUnique({ where: { id: auth.sub }, select: { id: true, email: true, name: true } });
  if (!profile) throw NotFound('Account');
  return { role: auth.role, ...profile };
}