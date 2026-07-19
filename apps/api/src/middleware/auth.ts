import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { auth } from 'express-oauth2-jwt-bearer';
import { config } from '../config';
import { query } from '../db/pool';
import { rowToUser } from '../db/mappers';
import { ApiError, asyncH } from '../http';

/**
 * Builds the authentication chain.
 * - With AUTH0_DOMAIN + AUTH0_AUDIENCE: validate RS256 JWTs via
 *   express-oauth2-jwt-bearer and extract sub/email from the payload.
 * - Without Auth0 config and DEV_AUTH_BYPASS=1: trust x-dev-sub / x-dev-email
 *   headers (local development only — logged loudly).
 */
export function authenticate(): RequestHandler[] {
  if (config.auth0Domain && config.auth0Audience) {
    const checkJwt = auth({
      audience: config.auth0Audience,
      issuerBaseURL: `https://${config.auth0Domain}/`,
      tokenSigningAlg: 'RS256',
    });
    const extract: RequestHandler = (req, _res, next) => {
      const payload = req.auth?.payload as Record<string, unknown> | undefined;
      const sub = typeof payload?.sub === 'string' ? payload.sub : null;
      if (!sub) return next(new ApiError(401, 'UNAUTHORIZED', 'Token has no subject'));
      const email =
        (typeof payload?.email === 'string' && payload.email) ||
        (typeof payload?.['https://pothole/email'] === 'string' &&
          (payload['https://pothole/email'] as string)) ||
        null;
      req.authInfo = { sub, email };
      next();
    };
    return [checkJwt, extract];
  }

  if (config.devAuthBypass) {
    console.warn(
      '[auth] *** DEV_AUTH_BYPASS is active — JWTs are NOT validated. ' +
        'Identity is taken from x-dev-sub / x-dev-email headers. NEVER use in production. ***',
    );
    const devAuth: RequestHandler = (req, _res, next) => {
      const sub = req.header('x-dev-sub');
      if (!sub) return next(new ApiError(401, 'UNAUTHORIZED', 'Missing x-dev-sub header (dev bypass mode)'));
      req.authInfo = { sub, email: req.header('x-dev-email') ?? null };
      next();
    };
    return [devAuth];
  }

  const unconfigured: RequestHandler = (_req, _res, next) => {
    next(
      new ApiError(
        503,
        'AUTH_NOT_CONFIGURED',
        'Set AUTH0_DOMAIN + AUTH0_AUDIENCE, or DEV_AUTH_BYPASS=1 for local development',
      ),
    );
  };
  return [unconfigured];
}

/** Look up the DB user for the authenticated sub and attach it (may be absent). */
export const attachUser: RequestHandler = asyncH(async (req: Request, _res: Response, next?: NextFunction) => {
  if (req.authInfo) {
    const { rows } = await query('SELECT * FROM users WHERE auth0_sub = $1', [req.authInfo.sub]);
    if (rows[0]) req.user = rowToUser(rows[0]);
  }
  next?.();
});

/** Requires a registered user row. */
export const requireUser: RequestHandler = (req, _res, next) => {
  if (!req.user) {
    return next(new ApiError(404, 'USER_NOT_REGISTERED', 'Complete signup first'));
  }
  next();
};

/** Requires an approved collector account (admins/owners pass too). */
export const requireApproved: RequestHandler = (req, _res, next) => {
  if (!req.user) return next(new ApiError(404, 'USER_NOT_REGISTERED', 'Complete signup first'));
  if (req.user.accountState !== 'approved') {
    return next(
      new ApiError(403, 'ACCOUNT_NOT_APPROVED', `Account is ${req.user.accountState}; wait for admin approval`),
    );
  }
  next();
};

/** Role gate. 'owner' always counts as 'admin'. */
export function requireRole(role: 'admin' | 'owner'): RequestHandler {
  return (req, _res, next) => {
    if (!req.user) return next(new ApiError(404, 'USER_NOT_REGISTERED', 'Complete signup first'));
    const r = req.user.role;
    const allowed = role === 'admin' ? r === 'admin' || r === 'owner' : r === 'owner';
    if (!allowed) return next(new ApiError(403, 'FORBIDDEN', 'Insufficient role'));
    next();
  };
}
