import { Router } from 'express';
import { query } from '../db/pool';
import { rowToLedgerEntry } from '../db/mappers';
import { asyncH, ok } from '../http';
import { requireUser } from '../middleware/auth';
import { ZERO_BALANCE, balanceSummary } from '../services/ledger';

export const earningsRouter = Router();

earningsRouter.get(
  '/earnings/ledger',
  requireUser,
  asyncH(async (req, res) => {
    const { rows } = await query(
      `SELECT * FROM ledger_entries WHERE user_id = $1 ORDER BY created_at DESC, id DESC`,
      [req.user!.id],
    );
    ok(res, rows.map(rowToLedgerEntry));
  }),
);

earningsRouter.get(
  '/earnings/summary',
  requireUser,
  asyncH(async (req, res) => {
    // Money is a collectors-only concept; everyone else sees zeros.
    ok(
      res,
      req.user!.isCollector ? await balanceSummary((t, p) => query(t, p), req.user!.id) : ZERO_BALANCE,
    );
  }),
);
