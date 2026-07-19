/**
 * Collector-facing community routes: leaderboard (feature 8) and
 * campaigns-near-me (feature 6).
 */
import { Router } from 'express';
import { z } from 'zod';
import {
  CAMPAIGNS,
  GAMIFICATION,
  haversineMeters,
  pointInPolygon,
  type LeaderboardEntry,
} from '@pothole/shared';
import { query } from '../db/pool';
import { rowToCampaign } from '../db/mappers';
import { asyncH, ok } from '../http';
import { requireUser } from '../middleware/auth';
import { acceptedDaysByUser, computeStreaks, displayName } from '../services/gamification';

export const communityRouter = Router();

/**
 * GET /leaderboard?period=month|all — top collectors by accepted +
 * partially_accepted samples (tie-break: earnings). The caller's own row is
 * appended when outside the top N.
 */
communityRouter.get(
  '/leaderboard',
  requireUser,
  asyncH(async (req, res) => {
    const period = z.enum(['month', 'all']).default('month').parse(req.query.period ?? 'month');
    const monthOnly = period === 'month';

    const { rows } = await query<{
      id: string;
      full_name: string;
      accepted: string;
      earned: string;
    }>(
      `SELECT u.id, u.full_name,
              COUNT(s.id) AS accepted,
              COALESCE((SELECT SUM(le.amount_inr) FROM ledger_entries le
                        WHERE le.user_id = u.id AND le.type = 'earning'
                          AND ($1 = false OR le.created_at >= date_trunc('month', now()))), 0) AS earned
       FROM users u
       JOIN samples s ON s.user_id = u.id
        AND s.state IN ('accepted', 'partially_accepted')
        AND ($1 = false OR s.reviewed_at >= date_trunc('month', now()))
       GROUP BY u.id, u.full_name
       ORDER BY accepted DESC, earned DESC, u.id`,
      [monthOnly],
    );

    const me = req.user!;
    const limit = GAMIFICATION.LEADERBOARD_LIMIT;
    const top = rows.slice(0, limit);
    const myIndex = rows.findIndex((r) => r.id === me.id);
    const includeIds = top.map((r) => r.id);
    if (myIndex >= limit) includeIds.push(me.id);

    const daysByUser = await acceptedDaysByUser(includeIds);
    const toEntry = (r: (typeof rows)[number], rank: number): LeaderboardEntry => ({
      rank,
      userId: r.id,
      displayName: displayName(r.full_name),
      acceptedSamples: Number(r.accepted),
      earnedInr: Number(r.earned),
      streakDays: computeStreaks(daysByUser.get(r.id) ?? []).streakDays,
      isMe: r.id === me.id,
    });

    const entries = top.map((r, i) => toEntry(r, i + 1));
    if (myIndex >= limit) entries.push(toEntry(rows[myIndex], myIndex + 1));
    ok(res, entries);
  }),
);

/**
 * GET /campaigns/nearby?lat=&lng= — active campaigns (within their date
 * window) containing the point, or whose nearest polygon vertex is within
 * CAMPAIGNS.NEARBY_RADIUS_M.
 */
communityRouter.get(
  '/campaigns/nearby',
  requireUser,
  asyncH(async (req, res) => {
    const q = z
      .object({ lat: z.coerce.number().min(-90).max(90), lng: z.coerce.number().min(-180).max(180) })
      .parse({ lat: req.query.lat, lng: req.query.lng });

    const { rows } = await query(
      `SELECT * FROM campaigns
       WHERE active = true
         AND (starts_at IS NULL OR starts_at <= now())
         AND (ends_at IS NULL OR ends_at >= now())
       ORDER BY created_at DESC`,
    );

    const nearby = rows
      .map(rowToCampaign)
      .map((c) => {
        const inside = c.polygon.length >= 3 && pointInPolygon(q.lat, q.lng, c.polygon);
        const distanceM = inside
          ? 0
          : Math.min(
              ...c.polygon.map((v) => haversineMeters(q.lat, q.lng, v.lat, v.lng)),
              Number.POSITIVE_INFINITY,
            );
        return { ...c, inside, distanceM: Math.round(distanceM) };
      })
      .filter((c) => c.inside || c.distanceM <= CAMPAIGNS.NEARBY_RADIUS_M)
      .sort((a, b) => a.distanceM - b.distanceM);

    ok(res, nearby);
  }),
);
