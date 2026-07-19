/**
 * Business rules for the pothole data-collection platform.
 * Single source of truth — the mobile app keeps a generated copy
 * (apps/mobile/src/shared/) because Expo/Metro does not follow the
 * workspace symlink; keep them in sync via `npm run sync-shared`.
 */

export const APP_NAME = 'PotholeCollect';
export const POWERED_BY = 'Threemates Tech Ventures';
export const APP_VERSION = '1.0.0';
export const API_VERSION = 'v1';

/** Speed rules for video (record) mode, km/h. */
export const SPEED = {
  /**
   * Real maximum acceptable speed — exceeding this rejects the sample.
   * There is NO minimum speed: anything below MAX_KMPH is fine.
   */
  MAX_KMPH: 65,
  /**
   * The speedometer shown to the user is capped at this value; the user is
   * only ever told the max is 60 km/h. Validation still uses MAX_KMPH.
   */
  DISPLAYED_CAP_KMPH: 60,
  /** GPS sampling interval while recording, ms. */
  GPS_SAMPLE_INTERVAL_MS: 1000,
} as const;

/** Video sample rules. */
export const VIDEO_RULES = {
  MIN_DURATION_SECONDS: 40,
  MIN_POTHOLES: 2,
} as const;

/**
 * Default collector plan (admin-assigned; regular users contribute without
 * payment — the platform is marketed as pothole SUBMISSION, not rewards).
 * Each track pays independently only when its full quota completes.
 */
export const DEFAULT_PACKAGE = {
  code: 'STARTER_1000',
  name: 'Starter Plan',
  videoQuota: 10, // pothole videos on a moving road → videoPayoutInr
  videoPayoutInr: 1000,
  photoQuota: 20, // pothole photos → photoPayoutInr
  photoPayoutInr: 1000,
  currency: 'INR',
} as const;

/** This email (or the very first signup) is bootstrapped as primary admin. */
export const PRIMARY_ADMIN_EMAIL = 'ujjwal@threemates.tech';

/** Duplicate detection thresholds. */
export const DEDUP = {
  /** Photos within this radius (meters) of an existing sample are checked hard. */
  GEO_RADIUS_METERS: 15,
  /** Hamming distance on 64-bit perceptual hash at/below which images are duplicates. */
  PHASH_HAMMING_THRESHOLD: 10,
} as const;

/** GPS quality requirements at capture time. */
export const GPS_RULES = {
  /** Required horizontal accuracy (meters) before capture may start. */
  MAX_ACCURACY_METERS: 15,
  /** Mock/simulated locations are always rejected. */
  ALLOW_MOCK: false,
} as const;

/** Things a sample must focus on / must avoid (used for UI guidance + admin checklist). */
export const CONTENT_GUIDELINES = {
  focus: ['road surface (any road type)', 'potholes and road damage'],
  avoid: [
    'plants and trees',
    'gaps or black spots on trees',
    'buildings',
    'vehicles',
    'humans',
    'animals',
    'signboards',
    'sky-dominant framing',
  ],
} as const;

/** Common pothole / road labels available in the annotator. */
export const POTHOLE_LABELS = [
  'pothole',
  'pothole-cluster',
  'crack-alligator',
  'crack-longitudinal',
  'edge-break',
  'raveling',
  'patch-failure',
] as const;

export const ROAD_TYPES = [
  'asphalt',
  'concrete',
  'gravel',
  'paver-block',
  'unpaved',
] as const;

/** Default densities used for fill-material estimation, kg/m3. */
export const FILL_MATERIALS = {
  'hot-mix-asphalt': 2400,
  'cold-mix-asphalt': 2200,
  concrete: 2400,
  'gravel-aggregate': 1600,
} as const;

/** Dataset export split rules — split by collector+geo bucket, never randomly. */
export const DATASET_SPLIT = {
  TRAIN: 0.8,
  VAL: 0.1,
  TEST: 0.1,
  /** Geohash precision used to bucket nearby scenes together (~150 m cells). */
  GEO_PRECISION: 7,
} as const;

/** Leaderboard / streak rules. */
export const GAMIFICATION = {
  /** A streak day = at least one accepted (or partially accepted) sample that day. */
  STREAK_MIN_ACCEPTED_PER_DAY: 1,
  LEADERBOARD_LIMIT: 50,
} as const;

/** Campaign (target-zone) defaults. */
export const CAMPAIGNS = {
  /** Default payout multiplier for samples captured inside an active zone. */
  DEFAULT_BOOST: 1.5,
  /** Radius used for "campaigns near me" lookups, meters. */
  NEARBY_RADIUS_M: 10_000,
} as const;

/** Settlements at/above this amount need a second admin's confirmation (₹). */
export const SETTLEMENT_CONFIRM_THRESHOLD_INR = 5000;

/** Road-quality index aggregation cell size (geohash precision, ~150 m). */
export const ROAD_QUALITY_GEO_PRECISION = 7;

export const UPLOAD = {
  MAX_PHOTO_BYTES: 25 * 1024 * 1024,
  MAX_VIDEO_BYTES: 1024 * 1024 * 1024, // 1 GB
  /** Chunk size for resumable uploads on slow networks. */
  CHUNK_BYTES: 1 * 1024 * 1024,
} as const;
