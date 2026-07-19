import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { MediaType, SampleState } from '@pothole/shared';
import type { AdminSampleRow } from '../api/client';
import { errorMessage, listSamples, sampleUserLabel } from '../api/client';
import { SampleDetailPanel } from '../components/SampleDetailPanel';
import { Chip, EmptyState, ErrorState, LoadingPanel, formatDate, stateTone } from '../components/ui';

type ListableState = Extract<SampleState, 'pending_review' | 'accepted' | 'rejected' | 'auto_rejected'>;
const ALL_STATES: ListableState[] = ['pending_review', 'accepted', 'rejected', 'auto_rejected'];

export function SamplesPage() {
  const [stateFilter, setStateFilter] = useState<'all' | ListableState>('all');
  const [typeFilter, setTypeFilter] = useState<'all' | MediaType>('all');
  const [userFilter, setUserFilter] = useState('');
  const [rows, setRows] = useState<AdminSampleRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [params, setParams] = useSearchParams();
  const openId = params.get('open');

  useEffect(() => {
    let cancelled = false;
    setRows(null);
    setError(null);
    const states: ListableState[] = stateFilter === 'all' ? ALL_STATES : [stateFilter];
    Promise.all(states.map((s) => listSamples(s).catch(() => [] as AdminSampleRow[])))
      .then((lists) => {
        if (cancelled) return;
        const merged = lists
          .flat()
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        setRows(merged);
      })
      .catch((err) => {
        if (!cancelled) setError(errorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [stateFilter, reloadKey]);

  const filtered = useMemo(() => {
    if (!rows) return null;
    const q = userFilter.trim().toLowerCase();
    return rows.filter((r) => {
      if (typeFilter !== 'all' && r.mediaType !== typeFilter) return false;
      if (q) {
        const hay = `${sampleUserLabel(r)} ${r.user?.email ?? ''} ${r.userEmail ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rows, typeFilter, userFilter]);

  const openSample = (id: string | null) => {
    const next = new URLSearchParams(params);
    if (id) next.set('open', id);
    else next.delete('open');
    setParams(next, { replace: false });
  };

  return (
    <div className="stack">
      <div className="card filter-bar">
        <label className="field inline">
          <span>State</span>
          <select value={stateFilter} onChange={(e) => setStateFilter(e.target.value as typeof stateFilter)}>
            <option value="all">All</option>
            {ALL_STATES.map((s) => (
              <option key={s} value={s}>
                {s.replace('_', ' ')}
              </option>
            ))}
          </select>
        </label>
        <label className="field inline">
          <span>Type</span>
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as typeof typeFilter)}>
            <option value="all">All</option>
            <option value="photo">photo</option>
            <option value="video">video</option>
          </select>
        </label>
        <label className="field inline grow">
          <span>User</span>
          <input
            type="search"
            value={userFilter}
            onChange={(e) => setUserFilter(e.target.value)}
            placeholder="Filter by name or email…"
          />
        </label>
        <button className="btn btn-sm btn-ghost" onClick={() => setReloadKey((k) => k + 1)}>
          ↻ Refresh
        </button>
      </div>

      {error ? (
        <ErrorState message={error} onRetry={() => setReloadKey((k) => k + 1)} />
      ) : filtered === null ? (
        <LoadingPanel label="Loading samples…" />
      ) : filtered.length === 0 ? (
        <EmptyState title="No samples match these filters" hint="Try widening the state or type filter." />
      ) : (
        <div className="card table-card">
          <div className="table-scroll">
            <table className="table row-hover">
              <thead>
                <tr>
                  <th></th>
                  <th>User</th>
                  <th>Type</th>
                  <th>State</th>
                  <th>Potholes</th>
                  <th>Captured</th>
                  <th>Location</th>
                  <th>Reason</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((s) => (
                  <tr key={s.id} onClick={() => openSample(s.id)}>
                    <td>
                      <span className="thumb-mini">{s.mediaType === 'video' ? '🎬' : '📷'}</span>
                    </td>
                    <td>
                      <strong>{sampleUserLabel(s)}</strong>
                    </td>
                    <td>
                      <Chip tone={s.mediaType === 'video' ? 'info' : 'accent'}>{s.mediaType}</Chip>
                    </td>
                    <td>
                      <Chip tone={stateTone(s.state)}>{s.state.replace('_', ' ')}</Chip>
                    </td>
                    <td>{s.potholeCount}</td>
                    <td className="muted">{formatDate(s.capturedAt)}</td>
                    <td className="muted small">
                      {s.lat.toFixed(4)}, {s.lng.toFixed(4)}
                    </td>
                    <td className="muted small">{s.rejectionReason || '—'}</td>
                    <td>
                      <button
                        className="btn btn-sm btn-ghost"
                        onClick={(e) => {
                          e.stopPropagation();
                          openSample(s.id);
                        }}
                      >
                        Open
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {openId ? (
        <div className="drawer-backdrop" onMouseDown={(e) => e.target === e.currentTarget && openSample(null)}>
          <div className="drawer">
            <div className="drawer-head">
              <h3>Sample detail</h3>
              <button className="btn btn-ghost btn-sm" onClick={() => openSample(null)}>
                ✕ Close
              </button>
            </div>
            <div className="drawer-body">
              <SampleDetailPanel key={openId} sampleId={openId} readOnly />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
