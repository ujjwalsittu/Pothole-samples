import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ZodError } from 'zod';
import type { ApiErr, ApiOk } from '@pothole/shared';

/** Typed application error carried through Express error handling. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function ok<T>(res: Response, data: T, status = 200): void {
  const body: ApiOk<T> = { ok: true, data };
  res.status(status).json(body);
}

type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<unknown> | unknown;

/** Wrap an async route handler so rejections reach the error middleware. */
export const asyncH =
  (fn: AsyncHandler): RequestHandler =>
  (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };

export function notFoundHandler(_req: Request, res: Response): void {
  const body: ApiErr = { ok: false, error: { code: 'NOT_FOUND', message: 'Route not found' } };
  res.status(404).json(body);
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (res.headersSent) return;
  let status = 500;
  let code = 'INTERNAL_ERROR';
  let message = 'Internal server error';
  if (err instanceof ApiError) {
    status = err.status;
    code = err.code;
    message = err.message;
  } else if (err instanceof ZodError) {
    status = 400;
    code = 'VALIDATION_ERROR';
    message = err.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ');
  } else if (err instanceof Error && err.name === 'UnauthorizedError') {
    // express-oauth2-jwt-bearer errors
    status = (err as Error & { status?: number }).status ?? 401;
    code = 'UNAUTHORIZED';
    message = err.message;
  } else if (err instanceof Error && 'type' in err && (err as { type?: string }).type === 'entity.too.large') {
    status = 413;
    code = 'PAYLOAD_TOO_LARGE';
    message = 'Request body too large';
  } else if (err instanceof Error) {
    console.error('[error]', err);
    const maybeStatus = (err as Error & { status?: number }).status;
    if (typeof maybeStatus === 'number' && maybeStatus >= 400 && maybeStatus < 500) {
      status = maybeStatus;
      code = 'BAD_REQUEST';
      message = err.message;
    }
  } else {
    console.error('[error]', err);
  }
  const body: ApiErr = { ok: false, error: { code, message } };
  res.status(status).json(body);
}
