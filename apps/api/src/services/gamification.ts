/**
 * Streak computation (feature 8). A streak day = at least
 * GAMIFICATION.STREAK_MIN_ACCEPTED_PER_DAY accepted (or partially accepted)
 * samples that day; the current streak must end today or yesterday.
 */
import { query } from '../db/pool';

const DAY_MS = 86_400_000;

const dayKey = (d: Date): string => d.toISOString().slice(0, 10);

export function computeStreaks(daysDesc: string[]): { streakDays: number; bestStreakDays: number } {
  if (daysDesc.length === 0) return { streakDays: 0, bestStreakDays: 0 };
  const days = [...new Set(daysDesc)].sort().reverse(); // newest first, unique

  const today = dayKey(new Date());
  const yesterday = dayKey(new Date(Date.now() - DAY_MS));

  let streakDays = 0;
  if (days[0] === today || days[0] === yesterday) {
    streakDays = 1;
    for (let i = 1; i < days.length; i++) {
      const prev = new Date(`${days[i - 1]}T00:00:00Z`).getTime();
      const cur = new Date(`${days[i]}T00:00:00Z`).getTime();
      if (prev - cur === DAY_MS) streakDays += 1;
      else break;
    }
  }

  let bestStreakDays = 1;
  let run = 1;
  for (let i = 1; i < days.length; i++) {
    const prev = new Date(`${days[i - 1]}T00:00:00Z`).getTime();
    const cur = new Date(`${days[i]}T00:00:00Z`).getTime();
    if (prev - cur === DAY_MS) run += 1;
    else run = 1;
    if (run > bestStreakDays) bestStreakDays = run;
  }
  return { streakDays, bestStreakDays };
}

/** Accepted-sample days (UTC, newest first) for one user. */
export async function acceptedDaysForUser(userId: string): Promise<string[]> {
  const { rows } = await query<{ d: string }>(
    `SELECT DISTINCT to_char(reviewed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS d
     FROM samples
     WHERE user_id = $1 AND state IN ('accepted', 'partially_accepted') AND reviewed_at IS NOT NULL
     ORDER BY d DESC`,
    [userId],
  );
  return rows.map((r) => r.d);
}

/** Accepted-sample days per user (one query), for leaderboard streaks. */
export async function acceptedDaysByUser(userIds: string[]): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (userIds.length === 0) return map;
  const { rows } = await query<{ user_id: string; d: string }>(
    `SELECT DISTINCT user_id, to_char(reviewed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS d
     FROM samples
     WHERE user_id = ANY($1) AND state IN ('accepted', 'partially_accepted') AND reviewed_at IS NOT NULL
     ORDER BY user_id, d DESC`,
    [userIds],
  );
  for (const r of rows) {
    const list = map.get(r.user_id) ?? [];
    list.push(r.d);
    map.set(r.user_id, list);
  }
  return map;
}

/** "Asha Collector" -> "Asha C." */
export function displayName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`;
}
