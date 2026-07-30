import { execFileSync } from 'node:child_process';
import { Router } from 'express';
import { API_VERSION, APP_VERSION, POWERED_BY } from '@pothole/shared';
import { pool } from '../db/pool';
import { asyncH, ok } from '../http';

export const metaRouter = Router();

/**
 * Which commit this process is actually running.
 *
 * APP_VERSION is a hand-maintained constant, so it cannot answer "did the
 * deploy land?". The server runs from a git clone (systemd WorkingDirectory is
 * /opt/pothole/apps/api), so asking git directly is authoritative. Resolved
 * once at startup — the answer cannot change without a restart, and that is
 * precisely the property that makes it useful: a `git pull` with no restart
 * still reports the OLD commit, which is the failure worth catching.
 *
 * GIT_COMMIT wins when set, for images built without a .git directory.
 */
function resolveCommit(): string {
  if (process.env.GIT_COMMIT) return process.env.GIT_COMMIT;
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd: __dirname,
      encoding: 'utf8',
      timeout: 2000,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return 'unknown';
  }
}

const COMMIT = resolveCommit();
const STARTED_AT = new Date().toISOString();

metaRouter.get(
  '/health',
  asyncH(async (_req, res) => {
    let db = false;
    try {
      await pool.query('SELECT 1');
      db = true;
    } catch {
      db = false;
    }
    ok(res, { status: 'ok', db, time: new Date().toISOString() });
  }),
);

metaRouter.get('/version', (_req, res) => {
  ok(res, {
    appVersion: APP_VERSION,
    apiVersion: API_VERSION,
    poweredBy: POWERED_BY,
    /** Short SHA of the running code, or 'unknown' outside a git checkout. */
    commit: COMMIT,
    /** Process start time — confirms the service actually restarted. */
    startedAt: STARTED_AT,
  });
});
