/**
 * Expo push notifications without an SDK dependency — POST to the public Expo
 * push endpoint. Every failure (bad token, network, no tokens) is a logged
 * no-op; pushes must never fail a request.
 */
import { query } from '../db/pool';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const BATCH_SIZE = 100;

export async function sendPush(
  userId: string,
  title: string,
  body: string,
  data?: Record<string, unknown>,
): Promise<void> {
  try {
    const { rows } = await query<{ token: string }>(
      'SELECT token FROM push_tokens WHERE user_id = $1',
      [userId],
    );
    if (rows.length === 0) return;

    const messages = rows.map((r) => ({
      to: r.token,
      title,
      body,
      sound: 'default' as const,
      ...(data ? { data } : {}),
    }));

    for (let i = 0; i < messages.length; i += BATCH_SIZE) {
      const batch = messages.slice(i, i + BATCH_SIZE);
      const res = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(batch),
      });
      if (!res.ok) {
        console.warn(`[push] expo returned ${res.status} for user ${userId}`);
        return;
      }
    }
    console.log(`[push] sent "${title}" to ${rows.length} device(s) of ${userId}`);
  } catch (err) {
    console.warn('[push] send failed:', (err as Error).message);
  }
}
