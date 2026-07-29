/**
 * Offline-first upload manager (singleton).
 *
 * Flow per queue item:
 *   draft -> initializing (POST /samples/init)
 *         -> uploading    (PUT chunks of UPLOAD.CHUNK_BYTES, sequential,
 *                          per-chunk retry with backoff, resumable from
 *                          uploadedChunks)
 *         -> completing   (POST /samples/:id/complete + annotations)
 *         -> done
 * Typed server rejections (DUPLICATE_*, SPEED_OUT_OF_RANGE, ...) mark the
 * item `rejected` locally — those samples can never be re-uploaded.
 * Transient errors mark it `failed` and it is retried on the next trigger:
 * app foreground, connectivity regained, or manual retry.
 */
import { AppState, type AppStateStatus } from 'react-native';
import * as FileSystem from 'expo-file-system';
import * as Network from 'expo-network';
import { ApiError, isRetryable } from '@/api/client';
import {
  completeSample,
  initSample,
  postAnnotations,
  uploadChunk,
  type AnnotationUpload,
} from '@/api/endpoints';
import { UPLOAD, type GpsPoint, type MediaType } from '@/shared';
import {
  insertQueueItem,
  listQueue,
  defaultMimeFor,
  parseMeta,
  pendingCount,
  updateQueueItem,
  type QueueItem,
  type SampleMeta,
} from './db';
import { readChunkBase64, sha256OfFile } from './hash';

export const SAMPLES_DIR = `${FileSystem.documentDirectory ?? ''}samples/`;

const FRIENDLY_REJECTIONS: Record<string, string> = {
  DUPLICATE_EXACT: 'This exact file was already submitted (by you or someone else).',
  DUPLICATE_PHASH: 'This image is too similar to an already-submitted sample.',
  DUPLICATE_LOCATION: 'A sample already exists at this location.',
  SPEED_OUT_OF_RANGE: 'Recording speed exceeded the limit — stay at or under 60 km/h.',
  VIDEO_TOO_SHORT: 'The video is shorter than the 40 second minimum.',
  TOO_FEW_POTHOLES: 'Videos need at least 2 marked potholes.',
  MOCK_LOCATION: 'A mock/simulated GPS location was detected. Samples must use real GPS.',
  GPS_ACCURACY: 'The GPS fix was not accurate enough for this sample.',
  FILE_TOO_LARGE: 'The media file exceeds the allowed size.',
};

/** Server codes that mean "permanently rejected — do not retry". */
function rejectionMessage(code: string): string | null {
  if (FRIENDLY_REJECTIONS[code]) return FRIENDLY_REJECTIONS[code];
  if (code.startsWith('DUPLICATE_')) return 'Duplicate sample detected.';
  return null;
}

export interface DraftInput {
  mediaType: MediaType;
  /** URI of the freshly captured media (cache); will be copied into app storage. */
  sourceUri: string;
  capturedAt: string;
  lat: number;
  lng: number;
  gpsAccuracyM: number;
  mockLocationDetected: boolean;
  durationSec: number | null;
  avgSpeedKmph: number | null;
  maxSpeedKmph: number | null;
  track: GpsPoint[] | null;
  /** Wall-clock ms when video recording started (null for photos). */
  recordingStartMs: number | null;
  annotations: AnnotationUpload[];
}

type Listener = () => void;

/** High-level queue events, surfaced as toasts in the UI. */
export interface UploadEvent {
  kind: 'done' | 'rejected' | 'failed';
  message: string;
}
type EventListener = (event: UploadEvent) => void;

class UploadManager {
  private running = false;
  private listeners = new Set<Listener>();
  private eventListeners = new Set<EventListener>();
  private started = false;
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  /** Call once from the root layout. */
  start(): void {
    if (this.started) return;
    this.started = true;
    AppState.addEventListener('change', (s: AppStateStatus) => {
      if (s === 'active') void this.kick();
    });
    // Connectivity listener where available (expo-network >= SDK 51 native),
    // with a low-frequency poll as fallback for older runtimes.
    const anyNetwork = Network as unknown as {
      addNetworkStateListener?: (cb: (state: Network.NetworkState) => void) => { remove(): void };
    };
    if (typeof anyNetwork.addNetworkStateListener === 'function') {
      anyNetwork.addNetworkStateListener((state) => {
        if (state.isInternetReachable) void this.kick();
      });
    }
    this.pollTimer = setInterval(() => {
      if (pendingCount() > 0) void this.kick();
    }, 30_000);
    void this.kick();
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private notify(): void {
    for (const fn of this.listeners) fn();
  }

  /** Subscribe to toast-worthy queue events (done / rejected / failed). */
  subscribeEvents(fn: EventListener): () => void {
    this.eventListeners.add(fn);
    return () => this.eventListeners.delete(fn);
  }

  private emit(event: UploadEvent): void {
    for (const fn of this.eventListeners) fn(event);
  }

  getQueue(): QueueItem[] {
    return listQueue();
  }

  getPendingCount(): number {
    return pendingCount();
  }

  /**
   * Creates a local draft: copies the media into
   * documentDirectory/samples/<localId>/, hashes it, stores metadata +
   * annotations in sqlite and starts uploading (or waits for connectivity).
   */
  async createDraft(input: DraftInput): Promise<string> {
    const localId = `smp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const ext = input.mediaType === 'photo' ? 'jpg' : 'mp4';
    const dir = `${SAMPLES_DIR}${localId}/`;
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
    const filePath = `${dir}media.${ext}`;
    await FileSystem.copyAsync({ from: input.sourceUri, to: filePath });

    const info = await FileSystem.getInfoAsync(filePath, { size: true });
    const sizeBytes = info.exists ? info.size ?? 0 : 0;
    const maxBytes = input.mediaType === 'photo' ? UPLOAD.MAX_PHOTO_BYTES : UPLOAD.MAX_VIDEO_BYTES;
    if (sizeBytes > maxBytes) {
      await FileSystem.deleteAsync(dir, { idempotent: true });
      const limit =
        input.mediaType === 'photo'
          ? `${Math.round(UPLOAD.MAX_PHOTO_BYTES / (1024 * 1024))} MB`
          : `${Math.round(UPLOAD.MAX_VIDEO_BYTES / (1024 * 1024 * 1024))} GB`;
      throw new Error(
        `This ${input.mediaType} is larger than the ${limit} limit — capture a shorter/smaller sample.`,
      );
    }
    const sha256 = await sha256OfFile(filePath);
    const totalChunks = Math.max(1, Math.ceil(sizeBytes / UPLOAD.CHUNK_BYTES));

    const meta: SampleMeta = {
      mediaType: input.mediaType,
      mediaMime: defaultMimeFor(input.mediaType),
      capturedAt: input.capturedAt,
      lat: input.lat,
      lng: input.lng,
      gpsAccuracyM: input.gpsAccuracyM,
      mockLocationDetected: input.mockLocationDetected,
      durationSec: input.durationSec,
      avgSpeedKmph: input.avgSpeedKmph,
      maxSpeedKmph: input.maxSpeedKmph,
      potholeCount: input.annotations.length,
      sizeBytes,
      sha256,
      // Client sends phash: null — the server computes the perceptual hash
      // (sharp) during auto-checks. Field kept for contract completeness.
      phash: null,
      track: input.track,
      recordingStartMs: input.recordingStartMs,
      annotations: input.annotations,
    };
    // Persist metadata JSON alongside the media too (debuggability / recovery).
    await FileSystem.writeAsStringAsync(`${dir}meta.json`, JSON.stringify(meta));

    insertQueueItem({
      id: localId,
      sampleLocalId: localId,
      filePath,
      metaJson: JSON.stringify(meta),
      state: 'draft',
      serverSampleId: null,
      uploadedChunks: 0,
      totalChunks,
      error: null,
      createdAt: Date.now(),
    });
    this.notify();
    void this.kick();
    return localId;
  }

  /** Manual retry of a failed item. */
  retry(id: string): void {
    updateQueueItem(id, { state: 'draft', error: null });
    this.notify();
    void this.kick();
  }

  /** Processes all pending items sequentially. Safe to call repeatedly. */
  async kick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const net = await Network.getNetworkStateAsync().catch(() => null);
      if (net && net.isInternetReachable === false) return;
      const pending = listQueue().filter((i) =>
        ['draft', 'initializing', 'uploading', 'completing', 'failed'].includes(i.state),
      );
      for (const item of pending) {
        await this.processItem(item);
      }
    } finally {
      this.running = false;
      this.notify();
    }
  }

  private async processItem(stale: QueueItem): Promise<void> {
    // Re-read: state may have changed since listing.
    const item = listQueue().find((i) => i.id === stale.id);
    if (!item) return;
    const meta = parseMeta(item);
    try {
      let serverSampleId = item.serverSampleId;
      let uploadedChunks = item.uploadedChunks;

      if (!serverSampleId) {
        updateQueueItem(item.id, { state: 'initializing' });
        this.notify();
        const res = await initSample({
          mediaType: meta.mediaType,
          mediaMime: meta.mediaMime,
          sha256: meta.sha256,
          phash: meta.phash,
          sizeBytes: meta.sizeBytes,
          capturedAt: meta.capturedAt,
          lat: meta.lat,
          lng: meta.lng,
          gpsAccuracyM: meta.gpsAccuracyM,
          mockLocationDetected: meta.mockLocationDetected,
          ...(meta.durationSec != null ? { durationSec: meta.durationSec } : {}),
          ...(meta.track && meta.track.length > 0
            ? {
                gpsTrack: {
                  recordingStartMs: meta.recordingStartMs ?? meta.track[0].t,
                  points: meta.track,
                },
              }
            : {}),
        });
        serverSampleId = res.sampleId;
        // The server reports progress in bytes, not chunks. Only whole chunks
        // count as done — a partial tail must be re-sent from its start.
        uploadedChunks = Math.floor((res.receivedBytes ?? 0) / UPLOAD.CHUNK_BYTES);
        updateQueueItem(item.id, { serverSampleId, uploadedChunks, state: 'uploading' });
        this.notify();
      } else {
        updateQueueItem(item.id, { state: 'uploading' });
        this.notify();
      }

      // Sequential chunk upload with per-chunk retry/backoff; progress is
      // persisted so slow networks still move forward and resume mid-file.
      for (let idx = uploadedChunks; idx < item.totalChunks; idx++) {
        const position = idx * UPLOAD.CHUNK_BYTES;
        const length = Math.min(UPLOAD.CHUNK_BYTES, meta.sizeBytes - position);
        const b64 = await readChunkBase64(item.filePath, position, length);
        await this.withRetry(() => uploadChunk(serverSampleId as string, idx, b64));
        updateQueueItem(item.id, { uploadedChunks: idx + 1 });
        this.notify();
      }

      updateQueueItem(item.id, { state: 'completing' });
      this.notify();
      await this.withRetry(() => completeSample(serverSampleId as string));
      if (meta.annotations.length > 0) {
        await this.withRetry(() => postAnnotations(serverSampleId as string, meta.annotations));
      }
      updateQueueItem(item.id, { state: 'done', error: null });
      this.emit({
        kind: 'done',
        message: `${meta.mediaType === 'photo' ? 'Photo' : 'Video'} sample uploaded.`,
      });
      this.notify();
    } catch (e) {
      if (e instanceof ApiError) {
        const friendly = rejectionMessage(e.code);
        if (friendly && !isRetryable(e)) {
          updateQueueItem(item.id, { state: 'rejected', error: friendly });
          this.emit({ kind: 'rejected', message: `Sample rejected: ${friendly}` });
          this.notify();
          return;
        }
        updateQueueItem(item.id, { state: 'failed', error: e.message });
        this.emit({ kind: 'failed', message: 'Upload failed — will retry automatically.' });
      } else {
        updateQueueItem(item.id, {
          state: 'failed',
          error: e instanceof Error ? e.message : 'Upload failed',
        });
        this.emit({ kind: 'failed', message: 'Upload failed — will retry automatically.' });
      }
      this.notify();
    }
  }

  private async withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
    let lastErr: unknown;
    for (let i = 0; i < attempts; i++) {
      try {
        return await fn();
      } catch (e) {
        lastErr = e;
        if (e instanceof ApiError && !isRetryable(e)) throw e;
        await new Promise((r) => setTimeout(r, 1000 * 2 ** i));
      }
    }
    throw lastErr;
  }
}

export const uploadManager = new UploadManager();
