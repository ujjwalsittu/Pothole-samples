/**
 * Local persistence for the offline upload queue (expo-sqlite, sync API).
 * Each row is one captured sample draft plus its upload progress.
 */
import * as SQLite from 'expo-sqlite';
import type { AnnotationUpload } from '@/api/endpoints';
import type { GpsPoint, MediaType } from '@/shared';

export type QueueState =
  | 'draft'
  | 'initializing'
  | 'uploading'
  | 'completing'
  | 'done'
  | 'failed' // transient failure — retryable
  | 'rejected'; // typed server rejection — NOT retryable, capture a new sample

/** Everything the server needs, captured at draft time. */
export interface SampleMeta {
  mediaType: MediaType;
  capturedAt: string; // ISO
  lat: number;
  lng: number;
  gpsAccuracyM: number;
  mockLocationDetected: boolean;
  durationSec: number | null;
  avgSpeedKmph: number | null;
  maxSpeedKmph: number | null;
  potholeCount: number;
  sizeBytes: number;
  sha256: string;
  phash: string | null;
  track: GpsPoint[] | null;
  annotations: AnnotationUpload[];
}

export interface QueueItem {
  id: string;
  sampleLocalId: string;
  filePath: string;
  metaJson: string;
  state: QueueState;
  serverSampleId: string | null;
  uploadedChunks: number;
  totalChunks: number;
  error: string | null;
  createdAt: number;
}

const db = SQLite.openDatabaseSync('potholecollect.db');

db.execSync(`
  CREATE TABLE IF NOT EXISTS upload_queue (
    id TEXT PRIMARY KEY,
    sampleLocalId TEXT NOT NULL,
    filePath TEXT NOT NULL,
    metaJson TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'draft',
    serverSampleId TEXT,
    uploadedChunks INTEGER NOT NULL DEFAULT 0,
    totalChunks INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    createdAt INTEGER NOT NULL
  );
`);

export function insertQueueItem(item: QueueItem): void {
  db.runSync(
    `INSERT INTO upload_queue
      (id, sampleLocalId, filePath, metaJson, state, serverSampleId, uploadedChunks, totalChunks, error, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    item.id,
    item.sampleLocalId,
    item.filePath,
    item.metaJson,
    item.state,
    item.serverSampleId,
    item.uploadedChunks,
    item.totalChunks,
    item.error,
    item.createdAt,
  );
}

export function listQueue(): QueueItem[] {
  return db.getAllSync<QueueItem>('SELECT * FROM upload_queue ORDER BY createdAt ASC');
}

export function getQueueItem(id: string): QueueItem | null {
  return db.getFirstSync<QueueItem>('SELECT * FROM upload_queue WHERE id = ?', id) ?? null;
}

export function pendingCount(): number {
  const row = db.getFirstSync<{ n: number }>(
    `SELECT COUNT(*) AS n FROM upload_queue WHERE state NOT IN ('done', 'rejected')`,
  );
  return row?.n ?? 0;
}

export function updateQueueItem(
  id: string,
  patch: Partial<Pick<QueueItem, 'state' | 'serverSampleId' | 'uploadedChunks' | 'error'>>,
): void {
  const sets: string[] = [];
  const args: (string | number | null)[] = [];
  if (patch.state !== undefined) {
    sets.push('state = ?');
    args.push(patch.state);
  }
  if (patch.serverSampleId !== undefined) {
    sets.push('serverSampleId = ?');
    args.push(patch.serverSampleId);
  }
  if (patch.uploadedChunks !== undefined) {
    sets.push('uploadedChunks = ?');
    args.push(patch.uploadedChunks);
  }
  if (patch.error !== undefined) {
    sets.push('error = ?');
    args.push(patch.error);
  }
  if (sets.length === 0) return;
  args.push(id);
  db.runSync(`UPDATE upload_queue SET ${sets.join(', ')} WHERE id = ?`, ...args);
}

export function deleteQueueItem(id: string): void {
  db.runSync('DELETE FROM upload_queue WHERE id = ?', id);
}

export function parseMeta(item: QueueItem): SampleMeta {
  return JSON.parse(item.metaJson) as SampleMeta;
}
