import { FILL_MATERIALS } from './constants';
import type { PolygonPoint, PotholeEstimate } from './types';

/**
 * Pothole size / material estimation.
 *
 * A single photo has no absolute scale, so we use a user-assisted reference:
 * the collector marks the visible road width in the photo (a line across the
 * road) and supplies the real road width in meters (or picks a typical value
 * for the road type). Everything else derives from that pixels-per-meter
 * scale. Estimates are stored as metadata only — the image itself is never
 * modified or watermarked.
 */

/** Shoelace area of a polygon in normalized [0..1] coords. */
export function polygonAreaNormalized(points: PolygonPoint[]): number {
  if (points.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

export interface ScaleReference {
  /** Length of the user-drawn road-width line, in normalized image units. */
  referenceLineNormalized: number;
  /** Real-world length of that line, meters. */
  referenceMeters: number;
  /** Image dimensions, px. */
  imageWidthPx: number;
  imageHeightPx: number;
}

/** Typical assumed pothole depth by severity, meters. */
export const DEPTH_BY_SEVERITY = { shallow: 0.04, medium: 0.08, deep: 0.15 } as const;
export type Severity = keyof typeof DEPTH_BY_SEVERITY;

/** Extra material to account for compaction of fill. */
const COMPACTION_FACTOR = 1.25;

export function estimatePothole(opts: {
  polygon: PolygonPoint[];
  scale: ScaleReference;
  roadType: string;
  roadWidthM: number | null;
  severity: Severity;
  fillMaterial: keyof typeof FILL_MATERIALS;
}): PotholeEstimate {
  const { polygon, scale, severity } = opts;
  // meters per normalized unit (use width axis; assumes near-planar road patch)
  const metersPerUnit =
    scale.referenceLineNormalized > 0
      ? scale.referenceMeters / scale.referenceLineNormalized
      : 0;

  const areaNorm = polygonAreaNormalized(polygon);
  // Correct for image aspect ratio: normalized area × (W×H in "unit meters")
  const aspect = scale.imageHeightPx / (scale.imageWidthPx || 1);
  const areaM2 = metersPerUnit > 0 ? areaNorm * metersPerUnit * metersPerUnit * aspect : null;

  const diameterM = areaM2 != null ? 2 * Math.sqrt(areaM2 / Math.PI) : null;
  const assumedDepthM = DEPTH_BY_SEVERITY[severity];
  const volumeM3 = areaM2 != null ? areaM2 * assumedDepthM : null;
  const density = FILL_MATERIALS[opts.fillMaterial];
  const materialKg =
    volumeM3 != null ? Math.round(volumeM3 * density * COMPACTION_FACTOR * 10) / 10 : null;

  return {
    roadType: opts.roadType,
    roadWidthM: opts.roadWidthM,
    diameterM: diameterM != null ? round2(diameterM) : null,
    areaM2: areaM2 != null ? round3(areaM2) : null,
    assumedDepthM,
    volumeM3: volumeM3 != null ? round3(volumeM3) : null,
    fillMaterial: opts.fillMaterial,
    materialKg,
  };
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const round3 = (n: number) => Math.round(n * 1000) / 1000;
