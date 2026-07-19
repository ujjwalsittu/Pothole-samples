/**
 * Builds the bifurcated, training-ready export structure for accepted samples:
 *   photos/<sampleId>/{<media>, annotations.json, meta.json}
 *   videos/<sampleId>/{<media>, annotations.json, track.json, meta.json}
 * Media bytes are never modified.
 */
import path from 'node:path';
import type { MediaType } from '@pothole/shared';
import { query } from '../db/pool';
import { rowToAnnotation, rowToSample } from '../db/mappers';
import { absPath, fileExists } from './storage';

export interface ExportJsonFile {
  name: string;
  content: string;
}

export interface ExportItem {
  /** e.g. photos/3f2a…/ or videos/9c1b…/ */
  dir: string;
  /** Absolute path of the media file on disk (null if missing). */
  mediaAbsPath: string | null;
  mediaFileName: string;
  jsonFiles: ExportJsonFile[];
}

export async function collectAcceptedExportItems(
  mediaType: MediaType | 'all',
): Promise<ExportItem[]> {
  const { rows } = await query(
    `SELECT s.*, u.email AS collector_email, u.full_name AS collector_name
     FROM samples s JOIN users u ON u.id = s.user_id
     WHERE s.state = 'accepted' AND ($1::text = 'all' OR s.media_type = $1)
     ORDER BY s.created_at`,
    [mediaType],
  );

  const items: ExportItem[] = [];
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
        .map((a) => ({ annotationId: a.id, label: a.label, ...a.estimate })),
    };

    const jsonFiles: ExportJsonFile[] = [
      { name: 'annotations.json', content: JSON.stringify(annotations, null, 2) },
      { name: 'meta.json', content: JSON.stringify(meta, null, 2) },
    ];
    if (isVideo) {
      const t = trackRes.rows[0];
      jsonFiles.push({
        name: 'track.json',
        content: JSON.stringify(
          t ? { recordingStartMs: Number(t.recording_start_ms), points: t.points } : null,
          null,
          2,
        ),
      });
    }

    const mediaRel = row.media_path as string | null;
    const mediaFileName = mediaRel ? path.basename(mediaRel) : `${sample.id}.bin`;
    items.push({
      dir,
      mediaAbsPath: mediaRel && fileExists(mediaRel) ? absPath(mediaRel) : null,
      mediaFileName,
      jsonFiles,
    });
  }
  return items;
}
