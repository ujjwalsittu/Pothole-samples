/** UI helpers for campaign zones: centroid, distance, compass direction. */
import { haversineMeters, pointInPolygon, type Campaign } from '@/shared';

export interface CampaignWithGeo extends Campaign {
  distanceM: number;
  direction: string;
  inside: boolean;
}

/** Rough polygon centroid (vertex average — fine for compact zones). */
export function campaignCenter(c: Campaign): { lat: number; lng: number } {
  if (c.polygon.length === 0) return { lat: 0, lng: 0 };
  let lat = 0;
  let lng = 0;
  for (const p of c.polygon) {
    lat += p.lat;
    lng += p.lng;
  }
  return { lat: lat / c.polygon.length, lng: lng / c.polygon.length };
}

/** Initial great-circle bearing (degrees, 0 = north). */
export function bearingDeg(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLng = toRad(lng2 - lng1);
  const y = Math.sin(dLng) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLng);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;

export function compassDirection(bearing: number): string {
  return COMPASS[Math.round(bearing / 45) % 8];
}

export function withGeo(campaigns: Campaign[], lat: number, lng: number): CampaignWithGeo[] {
  return campaigns
    .map((c) => {
      const center = campaignCenter(c);
      const inside = pointInPolygon(lat, lng, c.polygon);
      return {
        ...c,
        distanceM: inside ? 0 : haversineMeters(lat, lng, center.lat, center.lng),
        direction: compassDirection(bearingDeg(lat, lng, center.lat, center.lng)),
        inside,
      };
    })
    .sort((a, b) => a.distanceM - b.distanceM);
}

export function formatDistance(m: number): string {
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(1)} km`;
}

/** "12 Jan – 4 Feb" style active window, or null when open-ended both sides. */
export function activeWindow(c: Campaign): string | null {
  const fmt = (iso: string) =>
    new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  if (c.startsAt && c.endsAt) return `${fmt(c.startsAt)} – ${fmt(c.endsAt)}`;
  if (c.endsAt) return `until ${fmt(c.endsAt)}`;
  if (c.startsAt) return `from ${fmt(c.startsAt)}`;
  return null;
}
