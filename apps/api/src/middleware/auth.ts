import type { NextFunction, Request, Response } from 'express';
import { Forbidden, Unauthorized } from '../lib/errors';
import { verifyToken, type AuthUser, type Role } from '../lib/jwt';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthUser;
    }
  }
}

export function requireAuth(role?: Role) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) return next(Unauthorized());
    let user: AuthUser;
    try {
      user = verifyToken(header.slice(7));
    } catch {
      return next(Unauthorized('Invalid or expired token'));
    }
    if (role && user.role !== role) return next(Forbidden());
    req.auth = user;
    next();
  };
}

export const currentUser = (req: Request): AuthUser => {
  if (!req.auth) throw Unauthorized();
  return req.auth;
};