import { useCallback, useEffect, useState } from 'react';
import type { AdminSampleRow } from '../api/client';
import { errorMessage, listSamples, sampleUserLabel } from '../api/client';
import { SampleDetailPanel } from '../components/SampleDetailPanel';
import { Thumb } from '../components/Thumb';
import { Chip, EmptyState, ErrorState, LoadingPanel, formatDate } from '../components/ui';

export function ReviewQueuePage() {
  const [queue, setQueue] = useState<AdminSampleRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [decidedCount, setDecidedCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setQueue(null);
    setError(null);
    listSamples('pending_review')
      .then((rows) => {
        if (cancelled) return;
        const sorted = [...rows].sort(
          (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
        );
        setQueue(sorted);
        setSelectedId((prev) =>
          prev && sorted.some((s) => s.id === prev) ? prev : (sorted[0]?.id ?? null),
        );
      })
      .catch((err) => {
        if (!cancelled) setError(errorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const onDecided = useCallback(() => {
    setDecidedCount((c) => c + 1);
    setQueue((prev) => {
      if (!prev) return prev;
      const idx = prev.findIndex((s) => s.id === selectedId);
      const next = prev.filter((s) => s.id !== selectedId);
      // advance to the next sample in the queue
      const nextSel = next[Math.min(idx, next.length - 1)]?.id ?? null;
      setSelectedId(nextSel);
      return next;
    });
  }, [selectedId]);

  if (error) return <ErrorState message={error} onRetry={() => setReloadKey((k) => k + 1)} />;
  if (queue === null) return <LoadingPanel label="Loading review queue…" />;

  return (
    <div className="review-layout">
      <aside className="queue-col card">
        <div className="queue-head">
          <h4 className="card-title">
            Pending review <Chip tone="warn">{queue.length}</Chip>
          </h4>
          <button className="btn btn-sm btn-ghost" onClick={() => setReloadKey((k) => k + 1)}>
            ↻ Refresh
          </button>
        </div>
        {decidedCount > 0 ? (
          <p className="muted small">{decidedCount} reviewed this session</p>
        ) : null}
        {queue.length === 0 ? (
          <EmptyState title="Queue is clear 🎉" hint="New uploads that pass auto-checks land here." />
        ) : (
          <ul className="queue-list">
            {queue.map((s) => (
              <li
                key={s.id}
                className={`queue-item${s.id === selectedId ? ' selected' : ''}`}
                onClick={() => setSelectedId(s.id)}
              >
                <Thumb sampleId={s.id} mediaType={s.mediaType} />
                <div className="queue-item-main">
                  <div className="queue-item-user">{sampleUserLabel(s)}</div>
                  <div className="muted small">{formatDate(s.capturedAt)}</div>
                </div>
                <Chip tone={s.mediaType === 'video' ? 'info' : 'accent'}>{s.mediaType}</Chip>
              </li>
            ))}
          </ul>
        )}
      </aside>

      <section className="detail-col">
        {selectedId ? (
          <SampleDetailPanel key={selectedId} sampleId={selectedId} readOnly={false} onDecided={onDecided} />
        ) : (
          <div className="card">
            <EmptyState
              title="Nothing to review"
              hint="Select a sample from the queue, or wait for new uploads."
            />
          </div>
        )}
      </section>
    </div>
  );
}
