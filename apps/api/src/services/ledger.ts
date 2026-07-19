import type { PoolClient } from 'pg';
import type { EarningState, LedgerEntryType } from '@pothole/shared';

export interface LedgerInsert {
  userId: string;
  type: LedgerEntryType;
  /** Positive for earnings, negative for settlements. */
  amountInr: number;
  /** Earnings only: 'upcoming' until the media track's quota completes. */
  earningState?: EarningState | null;
  sampleId?: string | null;
  settlementId?: string | null;
  note?: string | null;
}

/**
 * Insert a ledger entry maintaining the running balance. Must be called inside
 * a transaction. Serializes concurrent inserts per user by locking the user's
 * latest entry (and the user row when the ledger is empty).
 */
export async function insertLedgerEntry(
  client: PoolClient,
  entry: LedgerInsert,
): Promise<{ id: string; balanceInr: number }> {
  // Lock the user row first so two first-ever entries cannot race.
  await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [entry.userId]);
  const last = await client.query<{ balance_inr: string }>(
    `SELECT balance_inr FROM ledger_entries
     WHERE user_id = $1
     ORDER BY created_at DESC, id DESC
     LIMIT 1
     FOR UPDATE`,
    [entry.userId],
  );
  const prev = last.rows[0] ? Number(last.rows[0].balance_inr) : 0;
  const balance = Math.round((prev + entry.amountInr) * 100) / 100;

  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO ledger_entries (user_id, type, amount_inr, earning_state, sample_id, settlement_id, note, balance_inr)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [
      entry.userId,
      entry.type,
      entry.amountInr,
      entry.type === 'earning' ? entry.earningState ?? 'upcoming' : null,
      entry.sampleId ?? null,
      entry.settlementId ?? null,
      entry.note ?? null,
      balance,
    ],
  );
  return { id: rows[0].id, balanceInr: balance };
}

export interface BalanceSummary {
  /** Gross earnings, upcoming + active. */
  earnedInr: number;
  settledInr: number;
  /** Withdrawable now: active earnings minus settlements. */
  activeInr: number;
  /** Accrued on incomplete tracks — not yet withdrawable. */
  upcomingInr: number;
  balanceInr: number;
}

const r2 = (n: number): number => Math.round(n * 100) / 100;

export const ZERO_BALANCE: BalanceSummary = {
  earnedInr: 0,
  settledInr: 0,
  activeInr: 0,
  upcomingInr: 0,
  balanceInr: 0,
};

/** Earned / settled / active / upcoming summary for a user. */
export async function balanceSummary(
  q: (text: string, params: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>,
  userId: string,
): Promise<BalanceSummary> {
  const { rows } = await q(
    `SELECT
       COALESCE(SUM(amount_inr) FILTER (WHERE type = 'earning'), 0)                                AS earned,
       COALESCE(SUM(amount_inr) FILTER (WHERE type = 'earning' AND earning_state = 'active'), 0)   AS active_earned,
       COALESCE(SUM(amount_inr) FILTER (WHERE type = 'earning' AND earning_state = 'upcoming'), 0) AS upcoming,
       COALESCE(-SUM(amount_inr) FILTER (WHERE type = 'settlement'), 0)                            AS settled
     FROM ledger_entries WHERE user_id = $1`,
    [userId],
  );
  const earnedInr = Number(rows[0]?.earned ?? 0);
  const settledInr = Number(rows[0]?.settled ?? 0);
  const upcomingInr = Number(rows[0]?.upcoming ?? 0);
  const activeEarned = Number(rows[0]?.active_earned ?? 0);
  return {
    earnedInr: r2(earnedInr),
    settledInr: r2(settledInr),
    activeInr: r2(activeEarned - settledInr),
    upcomingInr: r2(upcomingInr),
    balanceInr: r2(earnedInr - settledInr),
  };
}
