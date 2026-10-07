export class AppError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export const BadRequest = (m: string) => new AppError(400, 'BAD_REQUEST', m);
export const Unauthorized = (m = 'Authentication required') => new AppError(401, 'UNAUTHORIZED', m);
export const Forbidden = (m = 'Not allowed') => new AppError(403, 'FORBIDDEN', m);
export const NotFound = (what: string) => new AppError(404, 'NOT_FOUND', `${what} not found`);
export const Conflict = (code: string, m: string) => new AppError(409, code, m);
export const SoldOut = (name: string) =>
  new AppError(409, 'SOLD_OUT', `Not enough "${name}" tickets available`);