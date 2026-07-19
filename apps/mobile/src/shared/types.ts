/** Shared domain types — mirror of the PostgreSQL schema in apps/api/migrations. */

export type UserRole = 'collector' | 'admin' | 'owner';
/** Contributor occupation ('self' = self-employed/other). 'owner' is admin-assigned. */
export type CollectorStatus = 'student' | 'professional' | 'self' | 'owner';
export type AccountState = 'pending_approval' | 'approved' | 'rejected' | 'suspended';

export interface User {
  id: string;
  auth0Sub: string;
  email: string;
  fullName: string;
  photoUrl: string | null;
  role: UserRole;
  collectorStatus: CollectorStatus;
  /**
   * Paid-collector flag, ADMIN-ASSIGNED only. Regular users contribute
   * pothole reports voluntarily (the platform is marketed as pothole
   * submission, not rewards). Only collectors accrue earnings/withdrawals.
   */
  isCollector: boolean;
  /** College/University (students) or Company (professionals, optional). */
  organization: string | null;
  mobile: string | null;
  whatsappAvailable: boolean;
  /** Captured at signup, shown to admins. */
  signupLocation: { lat: number; lng: number; acc: number } | null;
  deviceFingerprint: Record<string, unknown> | null;
  /** Set when the collector first requests a withdrawal (not at signup). */
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
  /**
   * Content hash for integrity + exact-dup detection. NOT a raw-byte sha256:
   * clients hash the base64 representation (per-4MB composite for large
   * files) because expo-crypto cannot stream — see apps/mobile/src/upload/
   * hash.ts and contentHashOfFile in apps/api/src/services/storage.ts.
   */
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
  /** Earnings only: 'upcoming' until the media track's quota completes. */
  earningState: EarningState | null;
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
    videoPayoutInr: number;
    photoPayoutInr: number;
  };
  /** All money fields are zero / hidden for non-collectors. */
  earnedInr: number;
  settledInr: number;
  /** Withdrawable now: active earnings minus settlements. */
  activeInr: number;
  /** Accrued on incomplete tracks — not yet withdrawable. */
  upcomingInr: number;
  balanceInr: number;
}

/**
 * A configurable collector plan. Each media track pays out INDEPENDENTLY:
 * completing videoQuota accepted videos activates videoPayoutInr; completing
 * photoQuota accepted photos activates photoPayoutInr. Partial progress on a
 * track activates nothing (an incomplete photo track earns ₹0 even at
 * quota-1). Tracks repeat: every further full quota activates another payout.
 */
export interface PackageInfo {
  code: string;
  name: string;
  videoQuota: number;
  /** Payout for a completed video track (the "X" for videos). */
  videoPayoutInr: number;
  photoQuota: number;
  /** Payout for a completed photo track (the "Y" for photos). */
  photoPayoutInr: number;
  active: boolean;
  /** Package auto-assigned when this one completes (null = stop). */
  nextPackageCode: string | null;
}

/** Earning lifecycle: accrues as 'upcoming' per accepted sample; flips to
 * 'active' (withdrawable) only when its media track's quota completes. */
export type EarningState = 'upcoming' | 'active';

export type WithdrawalState = 'requested' | 'approved' | 'rejected' | 'paid';

/** A collector-initiated withdrawal request (UPI captured at request time). */
export interface WithdrawalRequest {
  id: string;
  userId: string;
  amountInr: number;
  upiId: string;
  state: WithdrawalState;
  note: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  settlementId: string | null;
  createdAt: string;
}

export type ModelKind = 'road-binary' | 'ssd-coco';

/** A geo-targeted collection campaign ("we need this zone covered"). */
export interface Campaign {
  id: string;
  name: string;
  description: string | null;
  /** Zone boundary as a closed polygon of [lat, lng] vertices. */
  polygon: Array<{ lat: number; lng: number }>;
  /** Payout multiplier for samples captured inside the zone. */
  boost: number;
  active: boolean;
  startsAt: string | null;
  endsAt: string | null;
  createdAt: string;
}

export interface LeaderboardEntry {
  rank: number;
  userId: string;
  displayName: string;
  acceptedSamples: number;
  earnedInr: number;
  /** Consecutive days (ending today/yesterday) with an accepted sample. */
  streakDays: number;
  isMe: boolean;
}

export type DatasetSplit = 'train' | 'val' | 'test';

/** Manifest recorded for every training-bundle export (dataset versioning). */
export interface DatasetManifest {
  id: string;
  createdAt: string;
  createdBy: string;
  /** sha256 of the zip actually produced. */
  bundleSha256: string;
  sampleCount: number;
  annotationCount: number;
  labelCounts: Record<string, number>;
  splitCounts: Record<DatasetSplit, number>;
  /** Per-sample assignment, keyed by sampleId. */
  samples: Array<{ sampleId: string; mediaType: MediaType; split: DatasetSplit; sha256: string }>;
}

/** One aggregated road-quality cell (geohash-based). */
export interface RoadQualityCell {
  geohash: string;
  lat: number;
  lng: number;
  sampleCount: number;
  potholeCount: number;
  /** 0 (good) .. 100 (very bad), from pothole density + severity. */
  severityIndex: number;
}

export interface AuditLogEntry {
  id: string;
  actorId: string;
  actorName: string;
  action: string; // e.g. 'user.approve', 'sample.review', 'settlement.confirm'
  targetType: string;
  targetId: string;
  detail: Record<string, unknown> | null;
  createdAt: string;
}

export type SettlementConfirmState = 'awaiting_confirmation' | 'confirmed' | 'cancelled';

/** Training-data export formats. PyTorch consumers use the COCO output. */
export type ExportFormat = 'coco' | 'yolo' | 'voc';

/** A published on-device TFLite model release (OTA-distributed to the app).
 * kind selects the app-side adapter: 'road-binary' = [1,224,224,3]u8 →
 * [roadProb,potholeProb]; 'ssd-coco' = SSD detector (e.g. SSDLite-MobileNetV2)
 * used for avoid-object guidance (people/vehicles/animals/signs). */
export interface ModelRelease {
  id: string;
  version: number;
  kind: ModelKind;
  filename: string;
  sha256: string;
  sizeBytes: number;
  notes: string | null;
  active: boolean;
  uploadedBy: string;
  createdAt: string;
}

/** OSRM manager status (admin services panel). */
export interface OsrmStatus {
  /** Effective OSRM endpoint used for map-matching, if any. */
  effectiveUrl: string | null;
  /** True when OSRM_URL env points at an externally managed server. */
  external: boolean;
  dataDownloaded: boolean;
  preprocessed: boolean;
  download: { inProgress: boolean; receivedBytes: number; totalBytes: number | null; url: string | null; error: string | null };
  preprocess: { inProgress: boolean; stage: string | null; error: string | null };
  serve: { running: boolean; pid: number | null; startedAt: string | null; error: string | null };
  /** How preprocessing/serving would run on this host. */
  runner: 'binaries' | 'docker' | 'unavailable';
}

/** Standard API envelope. */
export interface ApiOk<T> { ok: true; data: T; }
export interface ApiErr { ok: false; error: { code: string; message: string }; }
export type ApiResponse<T> = ApiOk<T> | ApiErr;
