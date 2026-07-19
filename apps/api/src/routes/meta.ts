import { Router } from 'express';
import { API_VERSION, APP_VERSION, POWERED_BY } from '@pothole/shared';
import { pool } from '../db/pool';
import { asyncH, ok } from '../http';

export const metaRouter = Router();

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
  ok(res, { appVersion: APP_VERSION, apiVersion: API_VERSION, poweredBy: POWERED_BY });
});
