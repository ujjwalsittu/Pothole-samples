import { Router } from 'express';
import type { DashboardStats } from '@pothole/shared';
import { query } from '../db/pool';
import { asyncH, ok } from '../http';
import { requireUser } from '../middleware/auth';
import { ZERO_BALANCE, balanceSummary } from '../services/ledger';

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
        partially_accepted: string;
        rejected: string;
        pending: string;
        photos_accepted: string;
        videos_accepted: string;
      }>(
        // Quota progress counts accepted + partially_accepted — both earn credit.
        `SELECT
           COUNT(*)                                                            AS total,
           COUNT(*) FILTER (WHERE state = 'accepted')                          AS accepted,
           COUNT(*) FILTER (WHERE state = 'partially_accepted')                AS partially_accepted,
           COUNT(*) FILTER (WHERE state IN ('rejected', 'auto_rejected'))      AS rejected,
           COUNT(*) FILTER (WHERE state = 'pending_review')                    AS pending,
           COUNT(*) FILTER (WHERE state IN ('accepted','partially_accepted') AND media_type = 'photo') AS photos_accepted,
           COUNT(*) FILTER (WHERE state IN ('accepted','partially_accepted') AND media_type = 'video') AS videos_accepted
         FROM samples WHERE user_id = $1`,
        [user.id],
      ),
      query<{
        video_quota: number;
        photo_quota: number;
        video_payout_inr: number;
        photo_payout_inr: number;
      }>(
        'SELECT video_quota, photo_quota, video_payout_inr, photo_payout_inr FROM packages WHERE code = $1',
        [user.packageCode],
      ),
      user.isCollector ? balanceSummary((t, p) => query(t, p), user.id) : Promise.resolve(ZERO_BALANCE),
    ]);

    const c = counts.rows[0];
    const p = pkg.rows[0] ?? { video_quota: 0, photo_quota: 0, video_payout_inr: 0, photo_payout_inr: 0 };

    const stats: DashboardStats = {
      totalSamples: Number(c.total),
      accepted: Number(c.accepted),
      partiallyAccepted: Number(c.partially_accepted),
      rejected: Number(c.rejected),
      pending: Number(c.pending),
      photosAccepted: Number(c.photos_accepted),
      videosAccepted: Number(c.videos_accepted),
      packageProgress: {
        videoQuota: Number(p.video_quota),
        photoQuota: Number(p.photo_quota),
        videosDone: Number(c.videos_accepted),
        photosDone: Number(c.photos_accepted),
        videoPayoutInr: user.isCollector ? Number(p.video_payout_inr) : 0,
        photoPayoutInr: user.isCollector ? Number(p.photo_payout_inr) : 0,
      },
      // All money fields are zero for non-collectors.
      earnedInr: money.earnedInr,
      settledInr: money.settledInr,
      activeInr: money.activeInr,
      upcomingInr: money.upcomingInr,
      balanceInr: money.balanceInr,
    };
    ok(res, stats);
  }),
);
