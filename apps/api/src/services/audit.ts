/**
 * Admin action audit trail. Every admin mutation calls audit(); failures are
 * logged but never fail the request.
 */
import { query } from '../db/pool';

export async function audit(
  actorId: string,
  action: string,
  targetType: string,
  targetId: string,
  detail?: Record<string, unknown>,
): Promise<void> {
  try {
    await query(
      `INSERT INTO audit_log (actor_id, action, target_type, target_id, detail)
       VALUES ($1, $2, $3, $4, $5)`,
      [actorId, action, targetType, targetId, detail ? JSON.stringify(detail) : null],
    );
  } catch (err) {
    console.error('[audit] failed to record', action, (err as Error).message);
  }
}
