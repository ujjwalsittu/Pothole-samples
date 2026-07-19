import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AuditLogEntry } from '@pothole/shared';
import { errorMessage, getAuditLog } from '../api/client';
import { Chip, EmptyState, ErrorState, LoadingPanel, Spinner, formatDate } from '../components/ui';

const PAGE_SIZE = 50;

function actionTone(action: string): 'good' | 'bad' | 'warn' | 'info' | 'neutral' {
  if (action.includes('approve') || action.includes('accept') || action.includes('confirm')) return 'good';
  if (action.includes('reject') || action.includes('delete') || action.includes('cancel')) return 'bad';
  if (action.includes('settlement')) return 'warn';
  if (action.includes('review') || action.includes('create') || action.includes('update')) return 'info';
  return 'neutral';
}

export function AuditPage() {
  const [entries, setEntries] = useState<AuditLogEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionFilter, setActionFilter] = useState('');
  const [actorFilter, setActorFilter] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [exhausted, setExhausted] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  // Debounce the server-side action filter a little.
  const [appliedAction, setAppliedAction] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setAppliedAction(actionFilter.trim()), 350);
    return () => clearTimeout(t);
  }, [actionFilter]);

  useEffect(() => {
    let cancelled = false;
    setEntries(null);
    setError(null);
    setExhausted(false);
    getAuditLog({ limit: PAGE_SIZE, action: appliedAction || undefined })
      .then((e) => {
        if (!cancelled) {
          setEntries(e);
          setExhausted(e.length < PAGE_SIZE);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(errorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [appliedAction, reloadKey]);

  const loadMore = useCallback(async () => {
    if (!entries || entries.length === 0 || loadingMore || exhausted) return;
    setLoadingMore(true);
    try {
      const last = entries[entries.length - 1];
      const more = await getAuditLog({
        limit: PAGE_SIZE,
        before: last.createdAt,
        action: appliedAction || undefined,
      });
      setEntries((prev) => {
        const seen = new Set((prev ?? []).map((e) => e.id));
        return [...(prev ?? []), ...more.filter((e) => !seen.has(e.id))];
      });
      if (more.length < PAGE_SIZE) setExhausted(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoadingMore(false);
    }
  }, [entries, loadingMore, exhausted, appliedAction]);

  const filtered = useMemo(() => {
    if (!entries) return null;
    const q = actorFilter.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter(
      (e) => e.actorName.toLowerCase().includes(q) || e.actorId.toLowerCase().includes(q),
    );
  }, [entries, actorFilter]);

  return (
    <div className="stack">
      <div className="card filter-bar">
        <label className="field inline">
          <span>Action prefix</span>
          <input
            type="search"
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
            placeholder="e.g. settlement. or sample.review"
          />
        </label>
        <label className="field inline grow">
          <span>Actor</span>
          <input
            type="search"
            value={actorFilter}
            onChange={(e) => setActorFilter(e.target.value)}
            placeholder="Filter loaded rows by admin name…"
          />
        </label>
        <button className="btn btn-sm btn-ghost" onClick={() => setReloadKey((k) => k + 1)}>
          ↻ Refresh
        </button>
      </div>

      {error && entries === null ? (
        <ErrorState message={error} onRetry={() => setReloadKey((k) => k + 1)} />
      ) : filtered === null ? (
        <LoadingPanel label="Loading audit log…" />
      ) : filtered.length === 0 ? (
        <EmptyState
          title="No audit entries"
          hint={appliedAction || actorFilter ? 'Try clearing the filters.' : 'Admin actions are recorded here.'}
        />
      ) : (
        <div className="card table-card">
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Actor</th>
                  <th>Action</th>
                  <th>Target</th>
                  <th>Detail</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((e) => (
                  <AuditRow
                    key={e.id}
                    entry={e}
                    expanded={expanded === e.id}
                    onToggle={() => setExpanded((cur) => (cur === e.id ? null : e.id))}
                  />
                ))}
              </tbody>
            </table>
          </div>
          <div className="row gap center-h load-more-row">
            {error ? <span className="error-text small">⚠ {error}</span> : null}
            {exhausted ? (
              <span className="muted small">End of audit log</span>
            ) : (
              <button className="btn btn-sm" disabled={loadingMore} onClick={() => void loadMore()}>
                {loadingMore ? (
                  <>
                    <Spinner small /> Loading…
                  </>
                ) : (
                  'Load more'
                )}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function AuditRow({
  entry,
  expanded,
  onToggle,
}: {
  entry: AuditLogEntry;
  expanded: boolean;
  onToggle: () => void;
}) {
  const hasDetail = entry.detail && Object.keys(entry.detail).length > 0;
  return (
    <>
      <tr className="audit-row" onClick={hasDetail ? onToggle : undefined} style={hasDetail ? { cursor: 'pointer' } : undefined}>
        <td className="muted small nowrap">{formatDate(entry.createdAt)}</td>
        <td>
          <strong>{entry.actorName}</strong>
        </td>
        <td>
          <Chip tone={actionTone(entry.action)}>{entry.action}</Chip>
        </td>
        <td className="muted small">
          {entry.targetType} <span className="mono">{entry.targetId.slice(0, 8)}…</span>
        </td>
        <td>
          {hasDetail ? (
            <button
              className="btn btn-sm btn-ghost"
              onClick={(e) => {
                e.stopPropagation();
                onToggle();
              }}
            >
              {expanded ? '▾ Hide' : '▸ Show'}
            </button>
          ) : (
            <span className="muted">—</span>
          )}
        </td>
      </tr>
      {expanded && hasDetail ? (
        <tr className="audit-detail-row">
          <td colSpan={5}>
            <pre className="audit-detail">{JSON.stringify(entry.detail, null, 2)}</pre>
          </td>
        </tr>
      ) : null}
    </>
  );
}
