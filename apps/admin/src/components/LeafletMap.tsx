import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

/**
 * Thin Leaflet wrapper: creates a map with an OSM tile layer and hands the
 * instance to the parent via onMap. The parent owns all layers/markers.
 */
export function LeafletMap({
  onMap,
  center = [20.5937, 78.9629], // India
  zoom = 5,
  height = 480,
}: {
  onMap: (map: L.Map) => void | (() => void);
  center?: [number, number];
  zoom?: number;
  height?: number | string;
}) {
  const divRef = useRef<HTMLDivElement | null>(null);
  const onMapRef = useRef(onMap);
  onMapRef.current = onMap;

  useEffect(() => {
    const el = divRef.current;
    if (!el) return;
    const map = L.map(el, { center, zoom, zoomControl: true });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);
    // Drawers/modals may still be animating when the map mounts.
    const t = setTimeout(() => map.invalidateSize(), 150);
    const cleanup = onMapRef.current(map);
    return () => {
      clearTimeout(t);
      if (typeof cleanup === 'function') cleanup();
      map.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={divRef} className="leaflet-host" style={{ height }} />;
}

/** Small circular div-icon marker (no image assets — bundler-safe). */
export function dotIcon(color: string, sizePx = 14): L.DivIcon {
  return L.divIcon({
    className: 'dot-marker',
    html: `<span style="display:block;width:${sizePx}px;height:${sizePx}px;border-radius:50%;background:${color};border:2px solid #0b1220;box-shadow:0 0 4px rgba(0,0,0,.6)"></span>`,
    iconSize: [sizePx, sizePx],
    iconAnchor: [sizePx / 2, sizePx / 2],
  });
}

export const STATE_COLORS: Record<string, string> = {
  pending_review: '#fbbf24',
  accepted: '#34d399',
  partially_accepted: '#2dd4bf',
  rejected: '#f87171',
  auto_rejected: '#b91c1c',
};

/** severityIndex 0 (good, green) → 100 (bad, red). */
export function severityColor(idx: number): string {
  const t = Math.min(100, Math.max(0, idx)) / 100;
  const hue = 120 * (1 - t); // 120=green → 0=red
  return `hsl(${hue.toFixed(0)}, 75%, 45%)`;
}
