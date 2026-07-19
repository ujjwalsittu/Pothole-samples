import type { PoolClient } from 'pg';
import type { LedgerEntryType } from '@pothole/shared';

export interface LedgerInsert {
  userId: string;
  type: LedgerEntryType;
  /** Positive for earnings, negative for settlements. */
  amountInr: number;
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
    `INSERT INTO ledger_entries (user_id, type, amount_inr, sample_id, settlement_id, note, balance_inr)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [
      entry.userId,
      entry.type,
      entry.amountInr,
      entry.sampleId ?? null,
      entry.settlementId ?? null,
      entry.note ?? null,
      balance,
    ],
  );
  return { id: rows[0].id, balanceInr: balance };
}

/** Earned / settled / balance summary for a user. */
export async function balanceSummary(
  q: (text: string, params: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>,
  userId: string,
): Promise<{ earnedInr: number; settledInr: number; balanceInr: number }> {
  const { rows } = await q(
    `SELECT
       COALESCE(SUM(amount_inr) FILTER (WHERE type = 'earning'), 0)     AS earned,
       COALESCE(-SUM(amount_inr) FILTER (WHERE type = 'settlement'), 0) AS settled
     FROM ledger_entries WHERE user_id = $1`,
    [userId],
  );
  const earnedInr = Number(rows[0]?.earned ?? 0);
  const settledInr = Number(rows[0]?.settled ?? 0);
  return {
    earnedInr,
    settledInr,
    balanceInr: Math.round((earnedInr - settledInr) * 100) / 100,
  };
}
