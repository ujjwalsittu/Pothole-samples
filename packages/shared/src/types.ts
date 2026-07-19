/** Shared domain types — mirror of the PostgreSQL schema in apps/api/migrations. */

export type UserRole = 'collector' | 'admin' | 'owner';
export type CollectorStatus = 'student' | 'professional' | 'owner';
export type AccountState = 'pending_approval' | 'approved' | 'rejected' | 'suspended';

export interface User {
  id: string;
  auth0Sub: string;
  email: string;
  fullName: string;
  photoUrl: string | null;
  role: UserRole;
  collectorStatus: CollectorStatus;
  upiId: string | null;
  accountState: AccountState;
  packageCode: string;
  createdAt: string;
  approvedAt: string | null;
}

export type MediaType = 'photo' | 'video';
export type SampleState =
  | 'draft'            // captured on device, not yet uploaded
  | 'uploading'        // chunked upload in progress
  | 'uploaded'         // media + metadata received, running auto checks
  | 'auto_rejected'    // failed automatic validation (speed, duration, dedup, mock GPS)
  | 'pending_review'   // waiting for an admin
  | 'accepted'
  | 'partially_accepted' // admin accepted the sample but only a subset of its annotations
  | 'rejected';        // rejected by admin — cannot be re-uploaded, a NEW sample is required

export interface GpsPoint {
  /** ms since epoch (device clock). */
  t: number;
  lat: number;
  lng: number;
  /** Horizontal accuracy in meters. */
  acc: number;
  /** Speed in m/s as reported by the GPS provider. */
  speedMps: number | null;
  /** Altitude in meters if available. */
  alt: number | null;
  /** True if the OS flagged this fix as mocked/simulated. */
  mocked: boolean;
}

/** One vertex of an annotation polygon, in normalized image coords [0..1]. */
export interface PolygonPoint {
  x: number;
  y: number;
}

/** Per-annotation review status (admins can accept/reject individual annotations). */
export type AnnotationStatus = 'pending' | 'accepted' | 'rejected';
export type AnnotationAuthor = 'collector' | 'admin';

export interface Annotation {
  id: string;
  sampleId: string;
  label: string;
  status: AnnotationStatus;
  createdBy: AnnotationAuthor;
  polygon: PolygonPoint[];
  /**
   * For video samples: the video timeline position (seconds) this annotation
   * belongs to. The pothole's coordinates are interpolated from the GPS track
   * at (recordingStartedAt + videoTimeSec).
   */
  videoTimeSec: number | null;
  /** Interpolated/attached GPS coordinate of the pothole itself. */
  lat: number;
  lng: number;
  /** Optional physical estimates (photo samples). */
  estimate: PotholeEstimate | null;
}

export interface PotholeEstimate {
  roadType: (typeof import('./constants').ROAD_TYPES)[number] | string;
  /** Estimated road width in meters (user-assisted reference). */
  roadWidthM: number | null;
  /** Estimated pothole equivalent diameter, meters. */
  diameterM: number | null;
  /** Estimated pothole surface area, m^2. */
  areaM2: number | null;
  /** Assumed depth used for volume, meters. */
  assumedDepthM: number;
  /** Estimated volume, m^3. */
  volumeM3: number | null;
  /** Chosen fill material key from FILL_MATERIALS. */
  fillMaterial: string;
  /** Estimated material mass required, kg (incl. compaction factor). */
  materialKg: number | null;
}

export interface Sample {
  id: string;
  userId: string;
  mediaType: MediaType;
  state: SampleState;
  /** SHA-256 of the exact media file bytes (integrity + exact-dup detection). */
  sha256: string;
  /** 64-bit perceptual hash, hex (photos; keyframes for videos). */
  phash: string | null;
  capturedAt: string;
  durationSec: number | null;      // video only
  avgSpeedKmph: number | null;     // video only, from GPS track
  maxSpeedKmph: number | null;     // video only
  lat: number;                     // photo: capture point; video: track start
  lng: number;
  gpsAccuracyM: number;
  mockLocationDetected: boolean;
  potholeCount: number;
  rejectionReason: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  mediaUrl: string | null;
  createdAt: string;
}

export type LedgerEntryType = 'earning' | 'settlement';

export interface LedgerEntry {
  id: string;
  userId: string;
  type: LedgerEntryType;
  /** Positive for earnings, negative for settlements (paid out). */
  amountInr: number;
  sampleId: string | null;
  settlementId: string | null;
  note: string | null;
  /** Running balance after this entry. */
  balanceInr: number;
  createdAt: string;
}

export type SettlementState = 'initiated' | 'settled';

export interface Settlement {
  id: string;
  userId: string;
  amountInr: number;
  state: SettlementState;
  /** Admin who performed the manual settlement. */
  settledBy: string | null;
  settledAt: string | null;
  /** Uploaded payment proof (screenshot / UTR reference). */
  proofUrl: string | null;
  utrReference: string | null;
  createdAt: string;
}

export interface DashboardStats {
  totalSamples: number;
  accepted: number;
  /** Accepted with only a subset of annotations — still counts toward the quota. */
  partiallyAccepted: number;
  rejected: number;
  pending: number;
  photosAccepted: number;
  videosAccepted: number;
  packageProgress: {
    videoQuota: number;
    photoQuota: number;
    videosDone: number;
    photosDone: number;
    payoutInr: number;
  };
  earnedInr: number;
  settledInr: number;
  balanceInr: number;
}

/** Standard API envelope. */
export interface ApiOk<T> { ok: true; data: T; }
export interface ApiErr { ok: false; error: { code: string; message: string }; }
export type ApiResponse<T> = ApiOk<T> | ApiErr;
