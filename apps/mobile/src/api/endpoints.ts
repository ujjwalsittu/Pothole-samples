/** Typed API surface used by the app. All calls go through the client wrapper. */
import { api } from './client';
import type {
  Annotation,
  Campaign,
  CollectorStatus,
  DashboardStats,
  LeaderboardEntry,
  LedgerEntry,
  ModelKind,
  PackageInfo,
  Sample,
  User,
  WithdrawalRequest,
} from '@/shared';

// ---------- auth / profile ----------

/** /me responses embed the user's current earnings package. */
export interface MeResponse extends User {
  package?: PackageInfo | null;
}

export function getMe(): Promise<MeResponse> {
  return api<MeResponse>('/me');
}

export interface SignupCompleteBody {
  fullName: string;
  /** Base64-encoded JPEG profile photo (optional). */
  photoBase64: string | null;
  collectorStatus: Exclude<CollectorStatus, 'owner'>;
  /** Required for students (College/University), optional for professionals. */
  organization: string | null;
  /** 10-15 digits. */
  mobile: string;
  whatsappAvailable: boolean;
  /** Best-effort GPS fix at signup (null when unavailable). */
  signupLocation: { lat: number; lng: number; acc: number } | null;
  deviceFingerprint: Record<string, unknown> | null;
}

export function signupComplete(body: SignupCompleteBody): Promise<MeResponse> {
  return api<MeResponse>('/auth/signup-complete', { method: 'POST', body });
}

export interface PatchMeBody {
  fullName?: string;
  upiId?: string;
  photoBase64?: string;
}

export function patchMe(body: PatchMeBody): Promise<MeResponse> {
  return api<MeResponse>('/me', { method: 'PATCH', body });
}

// ---------- campaigns / gamification / push ----------

export function getNearbyCampaigns(lat: number, lng: number): Promise<Campaign[]> {
  return api<Campaign[]>(`/campaigns/nearby?lat=${lat}&lng=${lng}`);
}

export type LeaderboardPeriod = 'month' | 'all';

export function getLeaderboard(period: LeaderboardPeriod): Promise<LeaderboardEntry[]> {
  return api<LeaderboardEntry[]>(`/leaderboard?period=${period}`);
}

export interface StreakInfo {
  streakDays: number;
  bestStreakDays: number;
}

export function getMyStreak(): Promise<StreakInfo> {
  return api<StreakInfo>('/me/streak');
}

export function registerPushToken(token: string, platform: string): Promise<{ ok: true } | object> {
  return api<{ ok: true } | object>('/me/push-token', {
    method: 'POST',
    body: { token, platform },
  });
}

// ---------- withdrawals (collectors only) ----------

export interface WithdrawalBody {
  amountInr: number;
  upiId: string;
}

/** 422 EXCEEDS_ACTIVE_BALANCE / 403 NOT_A_COLLECTOR surface as ApiError. */
export function createWithdrawal(body: WithdrawalBody): Promise<WithdrawalRequest> {
  return api<WithdrawalRequest>('/withdrawals', { method: 'POST', body });
}

export function getWithdrawals(): Promise<WithdrawalRequest[]> {
  return api<WithdrawalRequest[]>('/withdrawals');
}

// ---------- OTA detection model ----------

/** GET /models/latest — 404 with code NO_MODEL when nothing is published. */
export interface LatestModelInfo {
  version: number;
  kind: ModelKind;
  sha256: string;
  sizeBytes: number;
  notes: string | null;
  /** Server path of the binary stream (auth required). */
  url: string;
}

export function getLatestModel(): Promise<LatestModelInfo> {
  return api<LatestModelInfo>('/models/latest');
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
