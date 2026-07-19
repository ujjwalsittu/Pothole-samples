/**
 * Export bundle builders.
 *
 * - RAW bundle ('raw'): accepted + partially_accepted samples, unmodified
 *   media, FULL GPS (meta.json with coords/accuracy/speeds, track.json for
 *   videos) and ALL annotations with statuses — for real-world detection
 *   testing. Layout: photos/<id>/... , videos/<id>/...
 * - TRAINING bundle ('training'): accepted + partially_accepted samples but
 *   ONLY annotations with status 'accepted', and NO GPS DATA anywhere.
 *   Layout: images/, labels/coco/, labels/yolo/, labels/classes.txt, videos/.
 * - The legacy accepted.zip reuses the raw builder restricted to 'accepted'.
 *
 * Media bytes are never modified, and raw media/GPS is never deleted from
 * storage by any export.
 */
import path from 'node:path';
import type { MediaType, PolygonPoint } from '@pothole/shared';
import { query } from '../db/pool';
import { rowToAnnotation, rowToSample } from '../db/mappers';
import { getSharp } from './phash';
import { absPath, mediaExists, type StorageDriverName } from './storage';

export type BundleFile =
  | { kind: 'media'; name: string; relPath: string; storedOn: StorageDriverName }
  | { kind: 'text'; name: string; content: string };

export type BundleName = 'training' | 'raw';

interface SampleRow extends Record<string, unknown> {
  media_path: string | null;
  storage_driver: string | null;
  collector_email: string;
  collector_name: string;
}

async function loadSamples(states: string[], mediaType: MediaType | 'all'): Promise<SampleRow[]> {
  const { rows } = await query<SampleRow>(
    `SELECT s.*, u.email AS collector_email, u.full_name AS collector_name
     FROM samples s JOIN users u ON u.id = s.user_id
     WHERE s.state = ANY($1) AND ($2::text = 'all' OR s.media_type = $2)
     ORDER BY s.created_at`,
    [states, mediaType],
  );
  return rows;
}

const storedOnOf = (r: SampleRow): StorageDriverName =>
  ((r.storage_driver as string | null) ?? 'local') as StorageDriverName;

/* ------------------------------ raw bundle ------------------------------ */

export async function buildRawBundle(
  states: string[],
  mediaType: MediaType | 'all',
): Promise<BundleFile[]> {
  const rows = await loadSamples(states, mediaType);
  const files: BundleFile[] = [];

  for (const row of rows) {
    const sample = rowToSample(row);
    const isVideo = sample.mediaType === 'video';
    const dir = `${isVideo ? 'videos' : 'photos'}/${sample.id}/`;

    const [annRes, trackRes] = await Promise.all([
      query('SELECT * FROM annotations WHERE sample_id = $1 ORDER BY created_at', [sample.id]),
      isVideo
        ? query('SELECT recording_start_ms, points FROM gps_tracks WHERE sample_id = $1', [sample.id])
        : Promise.resolve({ rows: [] as Array<Record<string, unknown>> }),
    ]);
    const annotations = annRes.rows.map(rowToAnnotation);

    const meta = {
      sampleId: sample.id,
      mediaType: sample.mediaType,
      state: sample.state,
      capturedAt: sample.capturedAt,
      coordinates: { lat: sample.lat, lng: sample.lng },
      gpsAccuracyM: sample.gpsAccuracyM,
      durationSec: sample.durationSec,
      avgSpeedKmph: sample.avgSpeedKmph,
      maxSpeedKmph: sample.maxSpeedKmph,
      potholeCount: sample.potholeCount,
      sha256: sample.sha256,
      phash: sample.phash,
      collector: { id: sample.userId, email: row.collector_email, name: row.collector_name },
      reviewedAt: sample.reviewedAt,
      estimates: annotations
        .filter((a) => a.estimate != null)
        .map((a) => ({ annotationId: a.id, label: a.label, status: a.status, ...a.estimate })),
    };

    files.push({ kind: 'text', name: `${dir}annotations.json`, content: JSON.stringify(annotations, null, 2) });
    files.push({ kind: 'text', name: `${dir}meta.json`, content: JSON.stringify(meta, null, 2) });
    if (isVideo) {
      const t = trackRes.rows[0];
      files.push({
        kind: 'text',
        name: `${dir}track.json`,
        content: JSON.stringify(
          t ? { recordingStartMs: Number(t.recording_start_ms), points: t.points } : null,
          null,
          2,
        ),
      });
    }

    const rel = row.media_path;
    if (rel && (await mediaExists(rel, storedOnOf(row)))) {
      files.push({ kind: 'media', name: `${dir}${path.basename(rel)}`, relPath: rel, storedOn: storedOnOf(row) });
    }
  }
  return files;
}

/* ---------------------------- training bundle --------------------------- */

const bboxOfPolygon = (poly: PolygonPoint[]): { x: number; y: number; w: number; h: number } => {
  const xs = poly.map((p) => p.x);
  const ys = poly.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
};

const shoelace = (poly: PolygonPoint[]): number => {
  if (poly.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
};

const round = (n: number, dp = 4): number => Math.round(n * 10 ** dp) / 10 ** dp;

const TRAINING_README = `# Pothole training bundle

Generated for pothole-detection model training. Contains samples with review
state 'accepted' AND 'partially_accepted'; for partially accepted samples only
the admin-approved annotations are included (rejected ones are omitted).

THIS BUNDLE CONTAINS NO GPS DATA of any kind (no coordinates, no tracks).

Structure:
- images/<sampleId>.<ext>            original photo bytes (never modified)
- labels/coco/annotations.json       COCO: images[], categories[], annotations[]
                                     (polygon segmentation + bbox [x,y,w,h] + area).
                                     Where the image dimensions were known the
                                     coordinates are in pixels; otherwise the
                                     image entry carries "normalized": true and
                                     all of its coordinates are in [0..1].
- labels/yolo/<sampleId>.txt         one line per annotation:
                                     "<classIndex> <cx> <cy> <w> <h>" (normalized,
                                     bbox from polygon extents)
- labels/classes.txt                 class names; line N = YOLO class index N
                                     = COCO category id N+1
- videos/<sampleId>.<ext>            original video bytes
- videos/<sampleId>.annotations.json [{videoTimeSec, label, polygon}] only
`;

export async function buildTrainingBundle(): Promise<BundleFile[]> {
  const rows = await loadSamples(['accepted', 'partially_accepted'], 'all');
  const files: BundleFile[] = [{ kind: 'text', name: 'README.md', content: TRAINING_README }];
  const sharp = await getSharp();

  // Accepted annotations per sample + global class list.
  const perSample = new Map<
    string,
    Array<{ label: string; polygon: PolygonPoint[]; videoTimeSec: number | null }>
  >();
  const labelSet = new Set<string>();
  for (const row of rows) {
    const { rows: annRows } = await query(
      `SELECT label, polygon, video_time_sec FROM annotations
       WHERE sample_id = $1 AND status = 'accepted' ORDER BY created_at`,
      [row.id as string],
    );
    const anns = annRows.map((a) => ({
      label: a.label as string,
      polygon: (a.polygon ?? []) as PolygonPoint[],
      videoTimeSec: a.video_time_sec == null ? null : Number(a.video_time_sec),
    }));
    perSample.set(row.id as string, anns);
    for (const a of anns) labelSet.add(a.label);
  }

  const classes = [...labelSet].sort();
  const classIndex = new Map(classes.map((c, i) => [c, i]));
  files.push({ kind: 'text', name: 'labels/classes.txt', content: classes.join('\n') + '\n' });

  interface CocoImage {
    id: number;
    file_name: string;
    sample_id: string;
    width?: number;
    height?: number;
    normalized?: boolean;
  }
  interface CocoAnnotation {
    id: number;
    image_id: number;
    category_id: number;
    segmentation: number[][];
    bbox: number[];
    area: number;
    iscrowd: 0;
  }
  const cocoImages: CocoImage[] = [];
  const cocoAnnotations: CocoAnnotation[] = [];
  let imageId = 0;
  let annId = 0;

  for (const row of rows) {
    const sampleId = row.id as string;
    const anns = perSample.get(sampleId) ?? [];
    const rel = row.media_path;
    const storedOn = storedOnOf(row);
    const fileName = rel ? path.basename(rel) : `${sampleId}.bin`;
    const hasMedia = rel != null && (await mediaExists(rel, storedOn));

    if (row.media_type === 'video') {
      if (hasMedia && rel) {
        files.push({ kind: 'media', name: `videos/${fileName}`, relPath: rel, storedOn });
      }
      files.push({
        kind: 'text',
        name: `videos/${sampleId}.annotations.json`,
        content: JSON.stringify(
          anns.map((a) => ({ videoTimeSec: a.videoTimeSec, label: a.label, polygon: a.polygon })),
          null,
          2,
        ),
      });
      continue;
    }

    // Photo: media + COCO image entry + YOLO label file.
    if (hasMedia && rel) {
      files.push({ kind: 'media', name: `images/${fileName}`, relPath: rel, storedOn });
    }

    // Pixel dims when cheaply available (local media + sharp); else normalized.
    let dims: { width: number; height: number } | null = null;
    if (hasMedia && rel && storedOn === 'local' && sharp) {
      try {
        const m = await sharp(absPath(rel)).metadata();
        if (m.width && m.height) dims = { width: m.width, height: m.height };
      } catch {
        dims = null;
      }
    }

    imageId += 1;
    cocoImages.push({
      id: imageId,
      file_name: fileName,
      sample_id: sampleId,
      ...(dims ? { width: dims.width, height: dims.height } : { normalized: true }),
    });

    const yoloLines: string[] = [];
    for (const a of anns) {
      const bbox = bboxOfPolygon(a.polygon);
      const sx = dims ? dims.width : 1;
      const sy = dims ? dims.height : 1;
      annId += 1;
      cocoAnnotations.push({
        id: annId,
        image_id: imageId,
        category_id: (classIndex.get(a.label) ?? 0) + 1,
        segmentation: [a.polygon.flatMap((p) => [round(p.x * sx), round(p.y * sy)])],
        bbox: [round(bbox.x * sx), round(bbox.y * sy), round(bbox.w * sx), round(bbox.h * sy)],
        area: round(shoelace(a.polygon) * sx * sy),
        iscrowd: 0,
      });
      // YOLO labels are always normalized.
      yoloLines.push(
        `${classIndex.get(a.label) ?? 0} ${round(bbox.x + bbox.w / 2)} ${round(bbox.y + bbox.h / 2)} ${round(bbox.w)} ${round(bbox.h)}`,
      );
    }
    files.push({
      kind: 'text',
      name: `labels/yolo/${sampleId}.txt`,
      content: yoloLines.join('\n') + (yoloLines.length ? '\n' : ''),
    });
  }

  files.push({
    kind: 'text',
    name: 'labels/coco/annotations.json',
    content: JSON.stringify(
      {
        info: { description: 'PotholeCollect training export', date_created: new Date().toISOString() },
        images: cocoImages,
        categories: classes.map((c, i) => ({ id: i + 1, name: c })),
        annotations: cocoAnnotations,
      },
      null,
      2,
    ),
  });

  return files;
}

export function buildBundle(bundle: BundleName): Promise<BundleFile[]> {
  return bundle === 'training'
    ? buildTrainingBundle()
    : buildRawBundle(['accepted', 'partially_accepted'], 'all');
}
