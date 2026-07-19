/** Typed API surface used by the app. All calls go through the client wrapper. */
import { api } from './client';
import type {
  Annotation,
  CollectorStatus,
  DashboardStats,
  LedgerEntry,
  Sample,
  User,
} from '@/shared';

// ---------- auth / profile ----------

export function getMe(): Promise<User> {
  return api<User>('/me');
}

export interface SignupCompleteBody {
  fullName: string;
  collectorStatus: Exclude<CollectorStatus, 'owner'>;
  upiId: string;
  /** Base64-encoded JPEG profile photo (optional). */
  photoBase64: string | null;
}

export function signupComplete(body: SignupCompleteBody): Promise<User> {
  return api<User>('/auth/signup-complete', { method: 'POST', body });
}

export interface PatchMeBody {
  fullName?: string;
  upiId?: string;
  photoBase64?: string;
}

export function patchMe(body: PatchMeBody): Promise<User> {
  return api<User>('/me', { method: 'PATCH', body });
}

// ---------- dashboard / samples / earnings ----------

export function getDashboardStats(): Promise<DashboardStats> {
  return api<DashboardStats>('/dashboard/stats');
}

export function getMySamples(): Promise<Sample[]> {
  return api<Sample[]>('/samples');
}

/** Ledger rows enriched with settlement proof fields when type=settlement. */
export interface LedgerRow extends LedgerEntry {
  proofUrl?: string | null;
  utrReference?: string | null;
}

export interface LedgerResponse {
  earnedInr: number;
  settledInr: number;
  balanceInr: number;
  entries: LedgerRow[];
}

export function getLedger(): Promise<LedgerResponse> {
  return api<LedgerResponse>('/earnings/ledger');
}

// ---------- upload pipeline ----------

export interface SampleInitBody {
  clientSampleId: string;
  mediaType: 'photo' | 'video';
  sha256: string;
  phash: string | null;
  sizeBytes: number;
  totalChunks: number;
  capturedAt: string;
  lat: number;
  lng: number;
  gpsAccuracyM: number;
  mockLocationDetected: boolean;
  durationSec: number | null;
  avgSpeedKmph: number | null;
  maxSpeedKmph: number | null;
  potholeCount: number;
  /** Full GPS track for videos (JSON), null for photos. */
  track: unknown | null;
}

export interface SampleInitResponse {
  sampleId: string;
  /** Chunks the server already has (resume support). */
  uploadedChunks: number;
}

export function initSample(body: SampleInitBody): Promise<SampleInitResponse> {
  return api<SampleInitResponse>('/samples/init', { method: 'POST', body });
}

export function uploadChunk(sampleId: string, index: number, base64: string): Promise<{ received: number }> {
  return api<{ received: number }>(`/samples/${sampleId}/chunks/${index}`, {
    method: 'PUT',
    rawBody: base64,
    headers: { 'Content-Type': 'application/octet-stream;base64' },
  });
}

export function completeSample(sampleId: string): Promise<Sample> {
  return api<Sample>(`/samples/${sampleId}/complete`, { method: 'POST' });
}

/**
 * Client-side annotation payload. `status` (always starts 'pending') and
 * `createdBy` (always 'collector' for uploads) are set by the server.
 */
export type AnnotationUpload = Omit<Annotation, 'id' | 'sampleId' | 'status' | 'createdBy'>;

export function postAnnotations(sampleId: string, annotations: AnnotationUpload[]): Promise<{ count: number }> {
  return api<{ count: number }>(`/samples/${sampleId}/annotations`, {
    method: 'POST',
    body: { annotations },
  });
}

// ---------- admin ----------

export function adminPendingUsers(): Promise<User[]> {
  return api<User[]>('/admin/users/pending');
}

export function adminApproveUser(userId: string): Promise<User> {
  return api<User>(`/admin/users/${userId}/approve`, { method: 'POST' });
}

export function adminRejectUser(userId: string, reason: string): Promise<User> {
  return api<User>(`/admin/users/${userId}/reject`, { method: 'POST', body: { reason } });
}

export function adminPendingSamplesCount(): Promise<{ pendingReview: number }> {
  return api<{ pendingReview: number }>('/admin/samples/pending-count');
}
