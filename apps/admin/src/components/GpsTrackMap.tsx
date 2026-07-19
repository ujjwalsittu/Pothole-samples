import { useMemo } from 'react';
import type { GpsPoint } from '@pothole/shared';

/**
 * Inline SVG "map" of a GPS track — no external tiles or map libraries
 * (CSP-friendly). Projects lat/lng into a padded bounding-box viewport
 * using an equirectangular projection corrected for latitude.
 */

const W = 640;
const H = 360;
const PAD = 28;

export interface MapMarker {
  lat: number;
  lng: number;
  label?: string;
  highlighted?: boolean;
}

interface Projector {
  (lat: number, lng: number): { x: number; y: number };
}

function buildProjector(points: GpsPoint[]): Projector {
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;
  for (const p of points) {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lng < minLng) minLng = p.lng;
    if (p.lng > maxLng) maxLng = p.lng;
  }
  const midLat = (minLat + maxLat) / 2;
  const cos = Math.cos((midLat * Math.PI) / 180) || 1e-6;
  // meters-ish extents so aspect ratio is preserved
  const extX = Math.max((maxLng - minLng) * cos, 1e-9);
  const extY = Math.max(maxLat - minLat, 1e-9);
  const scale = Math.min((W - 2 * PAD) / extX, (H - 2 * PAD) / extY);
  const cx = ((minLng + maxLng) / 2) * cos;
  const cy = midLat;
  return (lat, lng) => ({
    x: W / 2 + (lng * cos - cx) * scale,
    y: H / 2 - (lat - cy) * scale,
  });
}

export function GpsTrackMap({
  points,
  cursor,
  markers = [],
}: {
  points: GpsPoint[];
  /** Current interpolated position (moving dot synced to video time). */
  cursor?: { lat: number; lng: number } | null;
  markers?: MapMarker[];
}) {
  const { path, project, start, end } = useMemo(() => {
    const sorted = [...points].sort((a, b) => a.t - b.t);
    const projectFn = buildProjector(sorted);
    const d = sorted
      .map((p, i) => {
        const { x, y } = projectFn(p.lat, p.lng);
        return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
    return {
      path: d,
      project: projectFn,
      start: sorted[0],
      end: sorted[sorted.length - 1],
    };
  }, [points]);

  if (points.length === 0) {
    return <div className="map-empty muted">No GPS track recorded for this sample.</div>;
  }

  const cursorPt = cursor ? project(cursor.lat, cursor.lng) : null;

  return (
    <svg
      className="gps-map"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label="GPS track map"
    >
      <rect x={0} y={0} width={W} height={H} className="map-bg" rx={10} />
      {/* subtle grid */}
      {Array.from({ length: 7 }, (_, i) => (
        <line key={`v${i}`} x1={(W / 8) * (i + 1)} y1={0} x2={(W / 8) * (i + 1)} y2={H} className="map-grid" />
      ))}
      {Array.from({ length: 4 }, (_, i) => (
        <line key={`h${i}`} x1={0} y1={(H / 5) * (i + 1)} x2={W} y2={(H / 5) * (i + 1)} className="map-grid" />
      ))}

      <path d={path} className="map-track-halo" />
      <path d={path} className="map-track" />

      {/* start / end markers */}
      {start ? (
        <g>
          <circle
            cx={project(start.lat, start.lng).x}
            cy={project(start.lat, start.lng).y}
            r={6}
            className="map-start"
          />
          <text {...offset(project(start.lat, start.lng), 10, -8)} className="map-label">
            start
          </text>
        </g>
      ) : null}
      {end ? (
        <g>
          <rect
            x={project(end.lat, end.lng).x - 5}
            y={project(end.lat, end.lng).y - 5}
            width={10}
            height={10}
            className="map-end"
          />
          <text {...offset(project(end.lat, end.lng), 10, 14)} className="map-label">
            end
          </text>
        </g>
      ) : null}

      {/* annotation markers */}
      {markers.map((m, i) => {
        const p = project(m.lat, m.lng);
        return (
          <g key={i}>
            <circle
              cx={p.x}
              cy={p.y}
              r={m.highlighted ? 8 : 5}
              className={m.highlighted ? 'map-marker highlighted' : 'map-marker'}
            />
            {m.label ? (
              <text x={p.x + 9} y={p.y + 4} className="map-label">
                {m.label}
              </text>
            ) : null}
          </g>
        );
      })}

      {/* moving dot synced to video currentTime */}
      {cursorPt ? (
        <g>
          <circle cx={cursorPt.x} cy={cursorPt.y} r={11} className="map-cursor-halo" />
          <circle cx={cursorPt.x} cy={cursorPt.y} r={5.5} className="map-cursor" />
        </g>
      ) : null}
    </svg>
  );
}

function offset(p: { x: number; y: number }, dx: number, dy: number): { x: number; y: number } {
  return { x: p.x + dx, y: p.y + dy };
}
