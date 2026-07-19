/**
 * In-memory hand-off between capture screens. expo-router params are strings,
 * so large capture payloads (media URIs, GPS tracks) travel through this
 * module-level session instead.
 */
import type { GpsPoint } from '@/shared';

export interface PhotoCapture {
  kind: 'photo';
  photoUri: string;
  width: number;
  height: number;
  capturedAt: string;
  lat: number;
  lng: number;
  accuracyM: number;
  mocked: boolean;
}

export interface VideoCapture {
  kind: 'video';
  videoUri: string;
  capturedAt: string;
  recordingStartMs: number;
  durationSec: number;
  track: GpsPoint[];
}

export type Capture = PhotoCapture | VideoCapture;

let current: Capture | null = null;
/** Whether the current capture flow started with no connectivity (queued mode). */
let offlineMode = false;

export function setCapture(c: Capture): void {
  current = c;
}

export function getPhotoCapture(): PhotoCapture | null {
  return current?.kind === 'photo' ? current : null;
}

export function getVideoCapture(): VideoCapture | null {
  return current?.kind === 'video' ? current : null;
}

export function clearCapture(): void {
  current = null;
}

export function setOfflineMode(v: boolean): void {
  offlineMode = v;
}

export function isOfflineMode(): boolean {
  return offlineMode;
}
