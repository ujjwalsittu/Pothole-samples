import { useEffect, useState } from 'react';
import type { LeaderboardEntry } from '@pothole/shared';
import { GAMIFICATION } from '@pothole/shared';
import { errorMessage, getLeaderboard } from '../api/client';
import { Chip, EmptyState, ErrorState, LoadingPanel, formatInr } from '../components/ui';

type Period = 'month' | 'all';

export function LeaderboardPage() {
  const [period, setPeriod] = useState<Period>('month');
  const [entries, setEntries] = useState<LeaderboardEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setEntries(null);
    setError(null);
    getLeaderboard(period)
      .then((e) => {
        if (!cancelled) setEntries([...e].sort((a, b) => a.rank - b.rank));
      })
      .catch((err) => {
        if (!cancelled) setError(errorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [period, reloadKey]);

  return (
    <div className="stack">
      <div className="row between wrap gap">
        <div className="tabs">
          <button className={`tab${period === 'month' ? ' active' : ''}`} onClick={() => setPeriod('month')}>
            This month
          </button>
          <button className={`tab${period === 'all' ? ' active' : ''}`} onClick={() => setPeriod('all')}>
            All time
          </button>
        </div>
        <span className="muted small">
          Top {GAMIFICATION.LEADERBOARD_LIMIT} collectors · streak = consecutive days with ≥
          {GAMIFICATION.STREAK_MIN_ACCEPTED_PER_DAY} accepted sample
        </span>
      </div>

      {error ? (
        <ErrorState message={error} onRetry={() => setReloadKey((k) => k + 1)} />
      ) : entries === null ? (
        <LoadingPanel label="Loading leaderboard…" />
      ) : entries.length === 0 ? (
        <EmptyState title="No ranked collectors yet" hint="Accepted samples put collectors on the board." />
      ) : (
        <div className="card table-card">
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Rank</th>
                  <th>Collector</th>
                  <th>Accepted samples</th>
                  <th>Earnings</th>
                  <th>Streak</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e.userId} className={e.rank <= 3 ? 'top-rank' : ''}>
                    <td>
                      <span className={`rank-badge rank-${Math.min(e.rank, 4)}`}>
                        {e.rank === 1 ? '🥇' : e.rank === 2 ? '🥈' : e.rank === 3 ? '🥉' : `#${e.rank}`}
                      </span>
                    </td>
                    <td>
                      <strong>{e.displayName}</strong> {e.isMe ? <Chip tone="accent">you</Chip> : null}
                    </td>
                    <td>{e.acceptedSamples}</td>
                    <td>{formatInr(e.earnedInr)}</td>
                    <td>
                      {e.streakDays > 0 ? (
                        <Chip tone={e.streakDays >= 7 ? 'accent' : 'neutral'}>🔥 {e.streakDays}d</Chip>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
