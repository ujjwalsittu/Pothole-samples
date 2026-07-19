/**
 * Collector-initiated withdrawals. Only ACTIVE earnings (completed tracks,
 * minus prior settlements) are withdrawable — upcoming earnings unlock when
 * their media track's quota completes.
 */
import { Router } from 'express';
import { z } from 'zod';
import { query, withTransaction } from '../db/pool';
import { rowToWithdrawal } from '../db/mappers';
import { ApiError, asyncH, ok } from '../http';
import { requireApproved } from '../middleware/auth';
import { balanceSummary } from '../services/ledger';
import { mail } from '../services/mail';
import { sendPush } from '../services/push';

export const withdrawalsRouter = Router();

/** Push a note to every admin/owner account. */
async function pushAdmins(title: string, body: string): Promise<void> {
  const { rows } = await query<{ id: string }>(
    `SELECT id FROM users WHERE role IN ('admin', 'owner')`,
  );
  for (const r of rows) void sendPush(r.id, title, body);
}

withdrawalsRouter.post(
  '/withdrawals',
  requireApproved,
  asyncH(async (req, res) => {
    const user = req.user!;
    if (!user.isCollector) {
      throw new ApiError(403, 'NOT_A_COLLECTOR', 'Withdrawals are available to collectors only');
    }
    const body = z
      .object({
        amountInr: z.coerce.number().positive(),
        upiId: z.string().trim().min(3),
      })
      .parse(req.body ?? {});

    const request = await withTransaction(async (client) => {
      await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [user.id]);
      const summary = await balanceSummary((t, p) => client.query(t, p as unknown[]), user.id);
      if (body.amountInr > summary.activeInr) {
        throw new ApiError(
          422,
          'EXCEEDS_ACTIVE_BALANCE',
          `You can withdraw up to ₹${summary.activeInr} right now. ₹${summary.upcomingInr} more is upcoming — it unlocks for withdrawal when the media track's quota completes.`,
        );
      }
      // UPI is captured at first withdrawal, kept on the profile.
      await client.query('UPDATE users SET upi_id = $2 WHERE id = $1', [user.id, body.upiId]);
      const ins = await client.query(
        `INSERT INTO withdrawal_requests (user_id, amount_inr, upi_id) VALUES ($1, $2, $3) RETURNING *`,
        [user.id, body.amountInr, body.upiId],
      );
      return rowToWithdrawal(ins.rows[0]);
    });

    void mail.withdrawalRequested(user.fullName, request.amountInr, request.upiId);
    void pushAdmins('Withdrawal request', `${user.fullName} requested ₹${request.amountInr}.`);
    ok(res, request, 201);
  }),
);

withdrawalsRouter.get(
  '/withdrawals',
  requireApproved,
  asyncH(async (req, res) => {
    const { rows } = await query(
      'SELECT * FROM withdrawal_requests WHERE user_id = $1 ORDER BY created_at DESC',
      [req.user!.id],
    );
    ok(res, rows.map(rowToWithdrawal));
  }),
);
