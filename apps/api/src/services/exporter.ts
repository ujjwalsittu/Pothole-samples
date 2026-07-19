/**
 * Export bundle builders.
 *
 * - RAW bundle ('raw'): accepted + partially_accepted samples, unmodified
 *   media, FULL GPS (meta.json with coords/accuracy/speeds, track.json for
 *   videos) and ALL annotations with statuses (incl. map-matching corrected
 *   coords when present) — for real-world detection testing.
 * - TRAINING bundle ('training'): accepted + partially_accepted samples,
 *   ONLY annotations with status 'accepted', NO GPS DATA anywhere.
 *   Dataset-versioned layout: train/ val/ test/ (deterministic
 *   collector+geo-cell split, see services/split.ts), each with
 *   images/, frames/, videos/, labels/{coco,yolo,classes.txt}; plus top-level
 *   manifest.json + README.md.
 * - The legacy accepted.zip reuses the raw builder restricted to 'accepted'.
 *
 * Media bytes are never modified, and raw media/GPS is never deleted from
 * storage by any export.
 */
import path from 'node:path';
import type { DatasetSplit, MediaType, PolygonPoint } from '@pothole/shared';
import { query } from '../db/pool';
import { rowToAnnotation, rowToSample } from '../db/mappers';
import { frameRelPath } from './frames';
import { getSharp } from './phash';
import { splitForSample } from './split';
import { absPath, activeDriver, mediaExists, type StorageDriverName } from './storage';

export type BundleFile =
  | { kind: 'media'; name: string; relPath: string; storedOn: StorageDriverName }
  | { kind: 'text'; name: string; content: string };

export type BundleName = 'training' | 'raw';

export interface TrainingManifestDraft {
  sampleCount: number;
  annotationCount: number;
  labelCounts: Record<string, number>;
  splitCounts: Record<DatasetSplit, number>;
  samples: Array<{ sampleId: string; mediaType: MediaType; split: DatasetSplit; sha256: string }>;
}

export interface TrainingBundleResult {
  files: BundleFile[];
  manifest: TrainingManifestDraft;
}

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

/** Find which driver actually holds a derived file (frames/thumbs). */
export async function findStored(relPath: string): Promise<StorageDriverName | null> {
  const primary = activeDriver();
  if (await mediaExists(relPath, primary)) return primary;
  if (primary !== 'local' && (await mediaExists(relPath, 'local'))) return 'local';
  return null;
}

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
      boostApplied: row.boost_applied == null ? null : Number(row.boost_applied),
      campaignId: (row.campaign_id as string | null) ?? null,
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

Dataset splits: every sample is deterministically assigned to train/ val/ or
test/ by hashing (collectorId + ~150m geohash cell) — the same collector in
the same place always lands in the same split, so near-duplicate scenes never
leak across splits. Ratios per shared DATASET_SPLIT constants. Never random.

Structure (inside each of train/ val/ test/):
- images/<sampleId>.<ext>            original photo bytes (never modified)
- frames/<sampleId>_<annotationId>.jpg  video frames extracted at each accepted
                                     annotation's timestamp; that annotation's
                                     polygon applies to the full frame
- labels/coco/annotations.json       COCO: images[], categories[], annotations[]
                                     (polygon segmentation + bbox [x,y,w,h] + area).
                                     Where the image dimensions were known the
                                     coordinates are in pixels; otherwise the
                                     image entry carries "normalized": true and
                                     all of its coordinates are in [0..1].
- labels/yolo/<imageStem>.txt        one line per annotation:
                                     "<classIndex> <cx> <cy> <w> <h>" (normalized,
                                     bbox from polygon extents)
- labels/classes.txt                 class names; line N = YOLO class index N
                                     = COCO category id N+1 (identical across splits)
- videos/<sampleId>.<ext>            original video bytes
- videos/<sampleId>.annotations.json [{videoTimeSec, label, polygon}] only

Top level: manifest.json (dataset version manifest; id/bundleSha256 live in
the server-side export registry, GET /admin/datasets).
`;

interface CocoImage {
  id: number;
  file_name: string;
  sample_id: string;
  annotation_source?: string;
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
interface PerSplitAcc {
  images: CocoImage[];
  annotations: CocoAnnotation[];
  imageId: number;
  annId: number;
}

export async function buildTrainingBundle(): Promise<TrainingBundleResult> {
  const rows = await loadSamples(['accepted', 'partially_accepted'], 'all');
  const files: BundleFile[] = [{ kind: 'text', name: 'README.md', content: TRAINING_README }];
  const sharp = await getSharp();

  interface Ann {
    id: string;
    label: string;
    polygon: PolygonPoint[];
    videoTimeSec: number | null;
  }
  const perSample = new Map<string, Ann[]>();
  const labelSet = new Set<string>();
  const labelCounts: Record<string, number> = {};
  let annotationCount = 0;

  for (const row of rows) {
    const { rows: annRows } = await query(
      `SELECT id, label, polygon, video_time_sec FROM annotations
       WHERE sample_id = $1 AND status = 'accepted' ORDER BY created_at`,
      [row.id as string],
    );
    const anns: Ann[] = annRows.map((a) => ({
      id: a.id as string,
      label: a.label as string,
      polygon: (a.polygon ?? []) as PolygonPoint[],
      videoTimeSec: a.video_time_sec == null ? null : Number(a.video_time_sec),
    }));
    perSample.set(row.id as string, anns);
    for (const a of anns) {
      labelSet.add(a.label);
      labelCounts[a.label] = (labelCounts[a.label] ?? 0) + 1;
      annotationCount += 1;
    }
  }

  const classes = [...labelSet].sort();
  const classIndex = new Map(classes.map((c, i) => [c, i]));

  const splits: DatasetSplit[] = ['train', 'val', 'test'];
  const acc = new Map<DatasetSplit, PerSplitAcc>(
    splits.map((s) => [s, { images: [], annotations: [], imageId: 0, annId: 0 }]),
  );
  const splitCounts: Record<DatasetSplit, number> = { train: 0, val: 0, test: 0 };
  const manifestSamples: TrainingManifestDraft['samples'] = [];

  const imageDims = async (
    rel: string,
    storedOn: StorageDriverName,
  ): Promise<{ width: number; height: number } | null> => {
    if (storedOn !== 'local' || !sharp) return null;
    try {
      const m = await sharp(absPath(rel)).metadata();
      return m.width && m.height ? { width: m.width, height: m.height } : null;
    } catch {
      return null;
    }
  };

  /** Add one image (photo or extracted frame) + its annotations to a split. */
  const addImage = async (
    split: DatasetSplit,
    opts: {
      bundlePath: string; // e.g. images/<id>.jpg or frames/<id>_<aid>.jpg
      sampleId: string;
      source?: string;
      rel: string | null;
      storedOn: StorageDriverName | null;
      anns: Ann[];
    },
  ): Promise<void> => {
    const a = acc.get(split)!;
    if (opts.rel && opts.storedOn) {
      files.push({
        kind: 'media',
        name: `${split}/${opts.bundlePath}`,
        relPath: opts.rel,
        storedOn: opts.storedOn,
      });
    }
    const dims = opts.rel && opts.storedOn ? await imageDims(opts.rel, opts.storedOn) : null;
    a.imageId += 1;
    a.images.push({
      id: a.imageId,
      file_name: opts.bundlePath,
      sample_id: opts.sampleId,
      ...(opts.source ? { annotation_source: opts.source } : {}),
      ...(dims ? { width: dims.width, height: dims.height } : { normalized: true }),
    });
    const stem = path.basename(opts.bundlePath).replace(/\.[^.]+$/, '');
    const yoloLines: string[] = [];
    for (const ann of opts.anns) {
      const bbox = bboxOfPolygon(ann.polygon);
      const sx = dims ? dims.width : 1;
      const sy = dims ? dims.height : 1;
      a.annId += 1;
      a.annotations.push({
        id: a.annId,
        image_id: a.imageId,
        category_id: (classIndex.get(ann.label) ?? 0) + 1,
        segmentation: [ann.polygon.flatMap((p) => [round(p.x * sx), round(p.y * sy)])],
        bbox: [round(bbox.x * sx), round(bbox.y * sy), round(bbox.w * sx), round(bbox.h * sy)],
        area: round(shoelace(ann.polygon) * sx * sy),
        iscrowd: 0,
      });
      yoloLines.push(
        `${classIndex.get(ann.label) ?? 0} ${round(bbox.x + bbox.w / 2)} ${round(bbox.y + bbox.h / 2)} ${round(bbox.w)} ${round(bbox.h)}`,
      );
    }
    files.push({
      kind: 'text',
      name: `${split}/labels/yolo/${stem}.txt`,
      content: yoloLines.join('\n') + (yoloLines.length ? '\n' : ''),
    });
  };

  for (const row of rows) {
    const sampleId = row.id as string;
    const anns = perSample.get(sampleId) ?? [];
    const split = splitForSample(row.user_id as string, Number(row.lat), Number(row.lng));
    splitCounts[split] += 1;
    manifestSamples.push({
      sampleId,
      mediaType: row.media_type as MediaType,
      split,
      sha256: row.sha256 as string,
    });

    const rel = row.media_path;
    const storedOn = storedOnOf(row);
    const fileName = rel ? path.basename(rel) : `${sampleId}.bin`;
    const hasMedia = rel != null && (await mediaExists(rel, storedOn));

    if (row.media_type === 'video') {
      if (hasMedia && rel) {
        files.push({ kind: 'media', name: `${split}/videos/${fileName}`, relPath: rel, storedOn });
      }
      files.push({
        kind: 'text',
        name: `${split}/videos/${sampleId}.annotations.json`,
        content: JSON.stringify(
          anns.map((a) => ({ videoTimeSec: a.videoTimeSec, label: a.label, polygon: a.polygon })),
          null,
          2,
        ),
      });
      // Extracted per-annotation frames become training images.
      for (const ann of anns) {
        const fRel = frameRelPath(sampleId, ann.id);
        const fStored = await findStored(fRel);
        if (!fStored) continue;
        await addImage(split, {
          bundlePath: `frames/${sampleId}_${ann.id}.jpg`,
          sampleId,
          source: 'video-frame',
          rel: fRel,
          storedOn: fStored,
          anns: [ann],
        });
      }
      continue;
    }

    await addImage(split, {
      bundlePath: `images/${fileName}`,
      sampleId,
      rel: hasMedia && rel ? rel : null,
      storedOn: hasMedia && rel ? storedOn : null,
      anns,
    });
  }

  for (const split of splits) {
    const a = acc.get(split)!;
    files.push({
      kind: 'text',
      name: `${split}/labels/classes.txt`,
      content: classes.join('\n') + (classes.length ? '\n' : ''),
    });
    files.push({
      kind: 'text',
      name: `${split}/labels/coco/annotations.json`,
      content: JSON.stringify(
        {
          info: {
            description: `PotholeCollect training export (${split})`,
            date_created: new Date().toISOString(),
          },
          images: a.images,
          categories: classes.map((c, i) => ({ id: i + 1, name: c })),
          annotations: a.annotations,
        },
        null,
        2,
      ),
    });
  }

  const manifest: TrainingManifestDraft = {
    sampleCount: rows.length,
    annotationCount,
    labelCounts,
    splitCounts,
    samples: manifestSamples,
  };
  files.push({
    kind: 'text',
    name: 'manifest.json',
    content: JSON.stringify({ ...manifest, createdAt: new Date().toISOString() }, null, 2),
  });

  return { files, manifest };
}

export async function buildBundle(bundle: BundleName): Promise<BundleFile[]> {
  return bundle === 'training'
    ? (await buildTrainingBundle()).files
    : buildRawBundle(['accepted', 'partially_accepted'], 'all');
}
