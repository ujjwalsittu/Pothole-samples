import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { User } from '@pothole/shared';
import type { AdminSampleRow } from '../api/client';
import { errorMessage, getUserBalance, listSamples, listUsers, sampleUserLabel } from '../api/client';
import { Chip, ErrorState, LoadingPanel, StatCard, formatDate, formatInr, stateTone } from '../components/ui';

interface OverviewData {
  pendingApprovals: number;
  pendingReview: number;
  accepted: number;
  partiallyAccepted: number;
  rejected: number;
  autoRejected: number;
  totalPayable: number | null; // null → could not compute
  recent: AdminSampleRow[];
}

export function OverviewPage() {
  const [data, setData] = useState<OverviewData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setData(null);

    (async () => {
      const [pendingUsers, pendingReview, accepted, partiallyAccepted, rejected, autoRejected, approvedUsers] =
        await Promise.all([
          listUsers('pending_approval'),
          listSamples('pending_review'),
          listSamples('accepted'),
          listSamples('partially_accepted').catch(() => [] as AdminSampleRow[]),
          listSamples('rejected'),
          listSamples('auto_rejected').catch(() => [] as AdminSampleRow[]),
          listUsers('approved').catch(() => [] as User[]),
        ]);

      // Total payable balance: sum per-user balances (tolerant of failures).
      let totalPayable: number | null = null;
      try {
        const balances = await Promise.all(
          approvedUsers.map((u) => getUserBalance(u.id).catch(() => null)),
        );
        const known = balances.filter((b): b is NonNullable<typeof b> => b !== null);
        totalPayable = known.reduce((s, b) => s + b.balanceInr, 0);
      } catch {
        totalPayable = null;
      }

      const recent = [...pendingReview, ...accepted, ...partiallyAccepted, ...rejected, ...autoRejected]
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, 12);

      return {
        pendingApprovals: pendingUsers.length,
        pendingReview: pendingReview.length,
        accepted: accepted.length,
        partiallyAccepted: partiallyAccepted.length,
        rejected: rejected.length + autoRejected.length,
        autoRejected: autoRejected.length,
        totalPayable,
        recent,
      } satisfies OverviewData;
    })()
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((err) => {
        if (!cancelled) setError(errorMessage(err));
      });

    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  if (error) return <ErrorState message={error} onRetry={() => setReloadKey((k) => k + 1)} />;
  if (!data) return <LoadingPanel label="Loading dashboard…" />;

  return (
    <div className="stack">
      <div className="stat-grid">
        <Link to="/approvals" className="plain-link">
          <StatCard label="Pending approvals" value={data.pendingApprovals} tone="warn" hint="collectors waiting" />
        </Link>
        <Link to="/review" className="plain-link">
          <StatCard label="Pending review" value={data.pendingReview} tone="accent" hint="samples in queue" />
        </Link>
        <StatCard label="Accepted samples" value={data.accepted} tone="good" />
        <StatCard
          label="Partially accepted"
          value={data.partiallyAccepted}
          tone="teal"
          hint="subset of annotations kept"
        />
        <StatCard
          label="Rejected samples"
          value={data.rejected}
          tone="bad"
          hint={data.autoRejected > 0 ? `incl. ${data.autoRejected} auto-rejected` : undefined}
        />
        <Link to="/settlements" className="plain-link">
          <StatCard
            label="Total payable balance"
            value={data.totalPayable != null ? formatInr(data.totalPayable) : '—'}
            hint={data.totalPayable != null ? 'across approved collectors' : 'balance endpoint unavailable'}
          />
        </Link>
      </div>

      <div className="card">
        <h4 className="card-title">Recent activity</h4>
        {data.recent.length === 0 ? (
          <p className="muted">No samples yet. Once collectors start uploading, the latest samples appear here.</p>
        ) : (
          <ul className="activity-list">
            {data.recent.map((s) => (
              <li key={s.id}>
                <span className="thumb-mini">{s.mediaType === 'video' ? '🎬' : '📷'}</span>
                <div className="activity-main">
                  <div>
                    <strong>{sampleUserLabel(s)}</strong> uploaded a {s.mediaType}
                  </div>
                  <div className="muted small">{formatDate(s.createdAt)}</div>
                </div>
                <Chip tone={stateTone(s.state)}>{s.state.replace('_', ' ')}</Chip>
                <Link className="btn btn-sm btn-ghost" to={`/samples?open=${s.id}`}>
                  View
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
