import jwt from 'jsonwebtoken';
import { env } from '../config/env';

export type Role = 'attendee' | 'organizer';
export interface AuthUser {
  sub: string;
  role: Role;
}

export const signToken = (user: AuthUser) =>
  jwt.sign({ sub: user.sub, role: user.role }, env.JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'],
  });

export function verifyToken(token: string): AuthUser {
  const p = jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'] });
  if (typeof p === 'string' || typeof p.sub !== 'string' || (p.role !== 'attendee' && p.role !== 'organizer'))
    throw new Error('Invalid token claims');
  return { sub: p.sub, role: p.role };
}