import type { User } from '@pothole/shared';

declare global {
  namespace Express {
    interface Request {
      /** Verified token identity (Auth0 sub + email when present). */
      authInfo?: { sub: string; email: string | null };
      /** DB user row mapped to the shared User shape (set by attachUser). */
      user?: User;
    }
  }
}

export {};
