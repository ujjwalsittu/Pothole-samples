import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import L from 'leaflet';
import type { Campaign, RoadQualityCell, SampleState } from '@pothole/shared';
import type { AdminSampleRow } from '../api/client';
import {
  errorMessage,
  fetchThumbBlob,
  getRoadQuality,
  listCampaigns,
  listSamples,
  sampleUserLabel,
} from '../api/client';
import { LeafletMap, STATE_COLORS, severityColor } from '../components/LeafletMap';
import { Chip, ErrorState, LoadingPanel } from '../components/ui';

type ListableState = Extract<
  SampleState,
  'pending_review' | 'accepted' | 'partially_accepted' | 'rejected' | 'auto_rejected'
>;
const ALL_STATES: ListableState[] = [
  'pending_review',
  'accepted',
  'partially_accepted',
  'rejected',
  'auto_rejected',
];

function buildPopup(s: AdminSampleRow): HTMLElement {
  const root = document.createElement('div');
  root.className = 'map-popup';

  const img = document.createElement('img');
  img.className = 'map-popup-thumb';
  img.alt = '';
  img.style.display = 'none';
  root.appendChild(img);

  const title = document.createElement('div');
  title.className = 'map-popup-title';
  title.textContent = `${s.mediaType === 'video' ? '🎬' : '📷'} ${sampleUserLabel(s)}`;
  root.appendChild(title);

  const meta = document.createElement('div');
  meta.className = 'map-popup-meta';
  meta.textContent = `${s.state.replace(/_/g, ' ')} · ${s.potholeCount} pothole(s)`;
  root.appendChild(meta);

  const link = document.createElement('a');
  link.href = `/samples?open=${encodeURIComponent(s.id)}`;
  link.textContent = 'Open detail →';
  root.appendChild(link);

  // Lazy-load the authed thumb when the popup is built (on open).
  fetchThumbBlob(s.id)
    .then((url) => {
      img.src = url;
      img.style.display = 'block';
    })
    .catch(() => {
      /* keep glyph-only popup */
    });

  return root;
}

export function MapPage() {
  const [map, setMap] = useState<L.Map | null>(null);
  const [samples, setSamples] = useState<AdminSampleRow[] | null>(null);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [cells, setCells] = useState<RoadQualityCell[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const [showSamples, setShowSamples] = useState(true);
  const [showCampaigns, setShowCampaigns] = useState(true);
  const [showHeatmap, setShowHeatmap] = useState(false);

  const [params] = useSearchParams();
  const focus = useMemo(() => {
    const raw = params.get('focus');
    if (!raw) return null;
    const [lat, lng] = raw.split(',').map(Number);
    return Number.isFinite(lat) && Number.isFinite(lng) ? ([lat, lng] as [number, number]) : null;
  }, [params]);

  /* ---- data ---- */
  useEffect(() => {
    let cancelled = false;
    setError(null);
    setSamples(null);
    Promise.all(ALL_STATES.map((s) => listSamples(s).catch(() => [] as AdminSampleRow[])))
      .then((lists) => {
        if (!cancelled) setSamples(lists.flat());
      })
      .catch((err) => {
        if (!cancelled) setError(errorMessage(err));
      });
    listCampaigns()
      .then((c) => {
        if (!cancelled) setCampaigns(c);
      })
      .catch(() => undefined);
    getRoadQuality()
      .then((c) => {
        if (!cancelled) setCells(c);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  /* ---- focus / fit ---- */
  useEffect(() => {
    if (!map) return;
    if (focus) {
      map.setView(focus, 16);
      return;
    }
    if (samples && samples.length > 0) {
      const bounds = L.latLngBounds(samples.map((s) => [s.lat, s.lng] as [number, number]));
      map.fitBounds(bounds.pad(0.2), { maxZoom: 14 });
    }
  }, [map, samples, focus]);

  /* ---- samples layer ---- */
  useEffect(() => {
    if (!map || !showSamples || !samples) return;
    const group = L.layerGroup();
    for (const s of samples) {
      if (!Number.isFinite(s.lat) || !Number.isFinite(s.lng)) continue;
      const marker = L.circleMarker([s.lat, s.lng], {
        radius: 6,
        weight: 1.5,
        color: '#0b1220',
        fillColor: STATE_COLORS[s.state] ?? '#8fa0bd',
        fillOpacity: 0.9,
      });
      marker.bindPopup(() => buildPopup(s), { minWidth: 180 });
      group.addLayer(marker);
    }
    group.addTo(map);
    return () => {
      group.remove();
    };
  }, [map, samples, showSamples]);

  /* ---- campaign zones layer ---- */
  useEffect(() => {
    if (!map || !showCampaigns || campaigns.length === 0) return;
    const group = L.layerGroup();
    for (const c of campaigns) {
      if (!c.polygon || c.polygon.length < 3) continue;
      const poly = L.polygon(
        c.polygon.map((p) => [p.lat, p.lng] as [number, number]),
        {
          color: c.active ? '#f59e0b' : '#8fa0bd',
          weight: 2,
          fillOpacity: 0.12,
          dashArray: c.active ? undefined : '6 6',
        },
      );
      poly.bindTooltip(`${c.name} · ×${c.boost}${c.active ? '' : ' (inactive)'}`, { sticky: true });
      group.addLayer(poly);
    }
    group.addTo(map);
    return () => {
      group.remove();
    };
  }, [map, campaigns, showCampaigns]);

  /* ---- road-quality heatmap layer ---- */
  useEffect(() => {
    if (!map || !showHeatmap || cells.length === 0) return;
    const group = L.layerGroup();
    for (const cell of cells) {
      const circle = L.circle([cell.lat, cell.lng], {
        radius: 90, // ≈ geohash-7 cell
        stroke: false,
        fillColor: severityColor(cell.severityIndex),
        fillOpacity: 0.55,
      });
      circle.bindTooltip(
        `severity ${Math.round(cell.severityIndex)} · ${cell.potholeCount} potholes / ${cell.sampleCount} samples`,
      );
      group.addLayer(circle);
    }
    group.addTo(map);
    return () => {
      group.remove();
    };
  }, [map, cells, showHeatmap]);

  return (
    <div className="stack">
      <div className="card filter-bar">
        <label className="check-label">
          <input type="checkbox" checked={showSamples} onChange={(e) => setShowSamples(e.target.checked)} />
          <span>Samples {samples ? `(${samples.length})` : ''}</span>
        </label>
        <label className="check-label">
          <input
            type="checkbox"
            checked={showCampaigns}
            onChange={(e) => setShowCampaigns(e.target.checked)}
          />
          <span>Campaign zones ({campaigns.length})</span>
        </label>
        <label className="check-label">
          <input type="checkbox" checked={showHeatmap} onChange={(e) => setShowHeatmap(e.target.checked)} />
          <span>Road-quality heatmap ({cells.length})</span>
        </label>
        <span className="row gap map-legend">
          {ALL_STATES.map((s) => (
            <span key={s} className="legend-item">
              <span className="legend-dot" style={{ background: STATE_COLORS[s] }} />
              <span className="muted small">{s.replace(/_/g, ' ')}</span>
            </span>
          ))}
        </span>
        <button className="btn btn-sm btn-ghost" onClick={() => setReloadKey((k) => k + 1)}>
          ↻ Refresh
        </button>
      </div>

      {error ? <ErrorState message={error} onRetry={() => setReloadKey((k) => k + 1)} /> : null}
      {!error && samples === null ? <LoadingPanel label="Loading map data…" /> : null}

      <div className="card map-card">
        <LeafletMap onMap={(m) => setMap(m)} height={560} />
        {samples && samples.length === 0 ? (
          <p className="muted small mt8">
            No geolocated samples yet — markers appear as collectors upload. <Chip tone="warn">empty</Chip>
          </p>
        ) : null}
      </div>
    </div>
  );
}
