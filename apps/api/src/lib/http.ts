import type { Request } from 'express';
import { z } from 'zod';

const uuid = z.string().uuid();
export const uuidParam = (req: Request, name: string) => uuid.parse(req.params[name]);

export const toPage = <T extends { id: string }>(items: T[], limit: number) => ({
  items,
  nextCursor: items.length === limit ? items[items.length - 1].id : null,
});