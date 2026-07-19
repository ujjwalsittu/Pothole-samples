import type { GpsPoint } from './types';

const EARTH_RADIUS_M = 6371000;

/** Haversine distance in meters. */
export function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a));
}

/**
 * Interpolate a coordinate on a GPS track at a given video-timeline second.
 * `recordingStartMs` is the wall-clock time recording began; track points use
 * the same clock (GpsPoint.t). Linear interpolation between the two nearest
 * fixes; clamps to track ends. This is the canonical way pothole coordinates
 * are derived from video annotations — annotations only store videoTimeSec,
 * so the coordinate can always be recomputed (and corrected) from the track.
 */
export function coordinateAtVideoTime(
  track: GpsPoint[],
  recordingStartMs: number,
  videoTimeSec: number,
): { lat: number; lng: number } | null {
  if (track.length === 0) return null;
  const target = recordingStartMs + videoTimeSec * 1000;
  const pts = [...track].sort((a, b) => a.t - b.t);
  if (target <= pts[0].t) return { lat: pts[0].lat, lng: pts[0].lng };
  const last = pts[pts.length - 1];
  if (target >= last.t) return { lat: last.lat, lng: last.lng };
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    if (target >= a.t && target <= b.t) {
      const f = b.t === a.t ? 0 : (target - a.t) / (b.t - a.t);
      return { lat: a.lat + (b.lat - a.lat) * f, lng: a.lng + (b.lng - a.lng) * f };
    }
  }
  return { lat: last.lat, lng: last.lng };
}

/** Average and max speed (km/h) over a track, derived from positions when the provider speed is missing. */
export function trackSpeedsKmph(track: GpsPoint[]): { avg: number; max: number } {
  const pts = [...track].sort((a, b) => a.t - b.t);
  if (pts.length < 2) return { avg: 0, max: 0 };
  let totalDist = 0;
  let max = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const dtH = (b.t - a.t) / 3_600_000;
    if (dtH <= 0) continue;
    const dKm = haversineMeters(a.lat, a.lng, b.lat, b.lng) / 1000;
    totalDist += dKm;
    const provider = b.speedMps != null ? b.speedMps * 3.6 : null;
    const derived = dKm / dtH;
    // Prefer provider speed; positional speed spikes with GPS jitter.
    const v = provider ?? Math.min(derived, 200);
    if (v > max) max = v;
  }
  const totalH = (pts[pts.length - 1].t - pts[0].t) / 3_600_000;
  return { avg: totalH > 0 ? totalDist / totalH : 0, max };
}

/** True if any fix in the track was flagged as mocked. */
export function hasMockedFix(track: GpsPoint[]): boolean {
  return track.some((p) => p.mocked);
}
