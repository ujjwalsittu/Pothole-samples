import { Router } from 'express';
import type { DashboardStats } from '@pothole/shared';
import { query } from '../db/pool';
import { asyncH, ok } from '../http';
import { requireUser } from '../middleware/auth';
import { balanceSummary } from '../services/ledger';

export const dashboardRouter = Router();

dashboardRouter.get(
  '/dashboard/stats',
  requireUser,
  asyncH(async (req, res) => {
    const user = req.user!;

    const [counts, pkg, money] = await Promise.all([
      query<{
        total: string;
        accepted: string;
        rejected: string;
        pending: string;
        photos_accepted: string;
        videos_accepted: string;
      }>(
        `SELECT
           COUNT(*)                                                            AS total,
           COUNT(*) FILTER (WHERE state = 'accepted')                          AS accepted,
           COUNT(*) FILTER (WHERE state IN ('rejected', 'auto_rejected'))      AS rejected,
           COUNT(*) FILTER (WHERE state = 'pending_review')                    AS pending,
           COUNT(*) FILTER (WHERE state = 'accepted' AND media_type = 'photo') AS photos_accepted,
           COUNT(*) FILTER (WHERE state = 'accepted' AND media_type = 'video') AS videos_accepted
         FROM samples WHERE user_id = $1`,
        [user.id],
      ),
      query<{ video_quota: number; photo_quota: number; payout_inr: number }>(
        'SELECT video_quota, photo_quota, payout_inr FROM packages WHERE code = $1',
        [user.packageCode],
      ),
      balanceSummary((t, p) => query(t, p), user.id),
    ]);

    const c = counts.rows[0];
    const p = pkg.rows[0] ?? { video_quota: 0, photo_quota: 0, payout_inr: 0 };

    const stats: DashboardStats = {
      totalSamples: Number(c.total),
      accepted: Number(c.accepted),
      rejected: Number(c.rejected),
      pending: Number(c.pending),
      photosAccepted: Number(c.photos_accepted),
      videosAccepted: Number(c.videos_accepted),
      packageProgress: {
        videoQuota: Number(p.video_quota),
        photoQuota: Number(p.photo_quota),
        videosDone: Number(c.videos_accepted),
        photosDone: Number(c.photos_accepted),
        payoutInr: Number(p.payout_inr),
      },
      earnedInr: money.earnedInr,
      settledInr: money.settledInr,
      balanceInr: money.balanceInr,
    };
    ok(res, stats);
  }),
);
