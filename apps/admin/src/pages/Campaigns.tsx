import { useCallback, useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import type { Campaign } from '@pothole/shared';
import { CAMPAIGNS } from '@pothole/shared';
import type { CampaignBody } from '../api/client';
import {
  createCampaign,
  deleteCampaign,
  errorMessage,
  listCampaigns,
  updateCampaign,
} from '../api/client';
import { LeafletMap, dotIcon } from '../components/LeafletMap';
import { Chip, EmptyState, ErrorState, LoadingPanel, Modal, formatDate } from '../components/ui';

type LatLng = { lat: number; lng: number };

function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInput(v: string): string | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function CampaignsPage() {
  const [campaigns, setCampaigns] = useState<Campaign[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [editing, setEditing] = useState<Campaign | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Campaign | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionErr, setActionErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setCampaigns(null);
    setError(null);
    listCampaigns()
      .then((c) => {
        if (!cancelled) {
          setCampaigns(
            [...c].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
          );
        }
      })
      .catch((err) => {
        if (!cancelled) setError(errorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const refresh = useCallback(() => setReloadKey((k) => k + 1), []);

  const confirmDelete = useCallback(async () => {
    if (!deleting) return;
    setBusy(true);
    setActionErr(null);
    try {
      await deleteCampaign(deleting.id);
      setDeleting(null);
      refresh();
    } catch (err) {
      setActionErr(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }, [deleting, refresh]);

  return (
    <div className="stack">
      <div className="row between wrap gap">
        <p className="muted small">
          Geo-targeted collection zones — samples captured inside an active zone earn a payout boost
          (default ×{CAMPAIGNS.DEFAULT_BOOST}).
        </p>
        <button className="btn btn-primary" onClick={() => setEditing('new')}>
          + New campaign
        </button>
      </div>

      {error ? (
        <ErrorState message={error} onRetry={refresh} />
      ) : campaigns === null ? (
        <LoadingPanel label="Loading campaigns…" />
      ) : campaigns.length === 0 ? (
        <EmptyState title="No campaigns yet" hint="Create a zone to boost collection where you need coverage." />
      ) : (
        <div className="card table-card">
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Zone</th>
                  <th>Boost</th>
                  <th>Status</th>
                  <th>Window</th>
                  <th>Created</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {campaigns.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <strong>{c.name}</strong>
                      {c.description ? <div className="muted small">{c.description}</div> : null}
                    </td>
                    <td className="muted small">
                      {c.polygon?.length ?? 0} vertices
                      {c.polygon && c.polygon.length > 0 ? (
                        <div>
                          @ {centroid(c.polygon).lat.toFixed(4)}, {centroid(c.polygon).lng.toFixed(4)}
                        </div>
                      ) : null}
                    </td>
                    <td>
                      <Chip tone="accent">×{c.boost}</Chip>
                    </td>
                    <td>
                      <Chip tone={c.active ? 'good' : 'neutral'}>{c.active ? 'active' : 'inactive'}</Chip>
                    </td>
                    <td className="muted small">
                      {c.startsAt ? formatDate(c.startsAt) : '—'} → {c.endsAt ? formatDate(c.endsAt) : '—'}
                    </td>
                    <td className="muted small">{formatDate(c.createdAt)}</td>
                    <td>
                      <span className="row gap">
                        <button className="btn btn-sm" onClick={() => setEditing(c)}>
                          Edit
                        </button>
                        <button className="btn btn-sm btn-danger" onClick={() => setDeleting(c)}>
                          Delete
                        </button>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {editing ? (
        <CampaignEditor
          campaign={editing === 'new' ? null : editing}
          others={(campaigns ?? []).filter((c) => editing === 'new' || c.id !== editing.id)}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            refresh();
          }}
        />
      ) : null}

      {deleting ? (
        <Modal title={`Delete campaign "${deleting.name}"?`} onClose={() => setDeleting(null)}>
          <p className="muted small">
            The zone and its boost are removed. Samples already credited keep their earnings.
          </p>
          {actionErr ? <p className="error-text">⚠ {actionErr}</p> : null}
          <div className="row gap end">
            <button className="btn btn-ghost" onClick={() => setDeleting(null)} disabled={busy}>
              Cancel
            </button>
            <button className="btn btn-danger" onClick={() => void confirmDelete()} disabled={busy}>
              {busy ? 'Deleting…' : 'Delete campaign'}
            </button>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

function centroid(poly: LatLng[]): LatLng {
  const n = poly.length || 1;
  return {
    lat: poly.reduce((s, p) => s + p.lat, 0) / n,
    lng: poly.reduce((s, p) => s + p.lng, 0) / n,
  };
}

/* ------------------------------------------------------------------ */
/* Editor: form + Leaflet polygon drawing                              */
/* ------------------------------------------------------------------ */

function CampaignEditor({
  campaign,
  others,
  onClose,
  onSaved,
}: {
  campaign: Campaign | null;
  others: Campaign[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [map, setMap] = useState<L.Map | null>(null);
  const [vertices, setVertices] = useState<LatLng[]>(campaign?.polygon ?? []);
  const [name, setName] = useState(campaign?.name ?? '');
  const [description, setDescription] = useState(campaign?.description ?? '');
  const [boost, setBoost] = useState<string>(String(campaign?.boost ?? CAMPAIGNS.DEFAULT_BOOST));
  const [active, setActive] = useState(campaign?.active ?? true);
  const [startsAt, setStartsAt] = useState(toLocalInput(campaign?.startsAt ?? null));
  const [endsAt, setEndsAt] = useState(toLocalInput(campaign?.endsAt ?? null));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  /* click to add vertices */
  useEffect(() => {
    if (!map) return;
    const onClick = (e: L.LeafletMouseEvent) => {
      setVertices((v) => [...v, { lat: e.latlng.lat, lng: e.latlng.lng }]);
    };
    map.on('click', onClick);
    return () => {
      map.off('click', onClick);
    };
  }, [map]);

  /* initial view */
  const centeredRef = useRef(false);
  useEffect(() => {
    if (!map || centeredRef.current) return;
    centeredRef.current = true;
    if (vertices.length >= 2) {
      map.fitBounds(L.latLngBounds(vertices.map((p) => [p.lat, p.lng] as [number, number])).pad(0.4));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map]);

  /* context: other campaigns */
  useEffect(() => {
    if (!map) return;
    const group = L.layerGroup();
    for (const c of others) {
      if (!c.polygon || c.polygon.length < 3) continue;
      const poly = L.polygon(
        c.polygon.map((p) => [p.lat, p.lng] as [number, number]),
        { color: '#8fa0bd', weight: 1.5, fillOpacity: 0.06, dashArray: '4 5', interactive: false },
      );
      poly.bindTooltip(c.name, { sticky: true });
      group.addLayer(poly);
    }
    group.addTo(map);
    return () => {
      group.remove();
    };
  }, [map, others]);

  /* editable polygon + draggable vertex markers */
  useEffect(() => {
    if (!map) return;
    const group = L.layerGroup();
    if (vertices.length >= 2) {
      group.addLayer(
        L.polygon(
          vertices.map((p) => [p.lat, p.lng] as [number, number]),
          { color: '#f59e0b', weight: 2, fillOpacity: 0.15 },
        ),
      );
    }
    vertices.forEach((p, i) => {
      const marker = L.marker([p.lat, p.lng], { icon: dotIcon('#f59e0b'), draggable: true });
      marker.on('dragend', () => {
        const ll = marker.getLatLng();
        setVertices((v) => v.map((q, j) => (j === i ? { lat: ll.lat, lng: ll.lng } : q)));
      });
      marker.on('contextmenu', () => {
        setVertices((v) => v.filter((_, j) => j !== i));
      });
      group.addLayer(marker);
    });
    group.addTo(map);
    return () => {
      group.remove();
    };
  }, [map, vertices]);

  const boostNum = Number(boost);
  const valid = name.trim().length > 0 && vertices.length >= 3 && Number.isFinite(boostNum) && boostNum > 0;

  const save = async () => {
    if (!valid) return;
    setBusy(true);
    setErr(null);
    const body: CampaignBody = {
      name: name.trim(),
      description: description.trim() || null,
      polygon: vertices,
      boost: boostNum,
      active,
      startsAt: fromLocalInput(startsAt),
      endsAt: fromLocalInput(endsAt),
    };
    try {
      if (campaign) await updateCampaign(campaign.id, body);
      else await createCampaign(body);
      onSaved();
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="drawer-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="drawer drawer-wide">
        <div className="drawer-head">
          <h3>{campaign ? `Edit "${campaign.name}"` : 'New campaign'}</h3>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>
            ✕ Close
          </button>
        </div>
        <div className="drawer-body">
          <p className="muted small">
            Click the map to add zone vertices · drag a marker to adjust · right-click a marker to remove
            it. Other campaign zones are shown dashed for context.
          </p>
          <LeafletMap onMap={(m) => setMap(m)} height={380} />
          <div className="row gap wrap mt8">
            <Chip tone={vertices.length >= 3 ? 'good' : 'warn'}>{vertices.length} vertices</Chip>
            <button
              className="btn btn-sm btn-ghost"
              disabled={vertices.length === 0}
              onClick={() => setVertices((v) => v.slice(0, -1))}
            >
              Undo last
            </button>
            <button className="btn btn-sm btn-ghost" disabled={vertices.length === 0} onClick={() => setVertices([])}>
              Reset zone
            </button>
          </div>

          <div className="form-grid mt8">
            <label className="field">
              <span>Name (required)</span>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. NH-48 Gurugram stretch" />
            </label>
            <label className="field">
              <span>Boost multiplier</span>
              <input type="number" min={1} step="0.1" value={boost} onChange={(e) => setBoost(e.target.value)} />
            </label>
            <label className="field span2">
              <span>Description</span>
              <textarea
                rows={2}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What needs covering and why"
              />
            </label>
            <label className="field">
              <span>Starts at (optional)</span>
              <input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
            </label>
            <label className="field">
              <span>Ends at (optional)</span>
              <input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
            </label>
            <label className="check-label">
              <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
              <span>Active</span>
            </label>
          </div>

          {err ? <p className="error-text">⚠ {err}</p> : null}
          <div className="row gap end mt8">
            <button className="btn btn-ghost" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button className="btn btn-primary" disabled={!valid || busy} onClick={() => void save()}>
              {busy ? 'Saving…' : campaign ? 'Save changes' : 'Create campaign'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
