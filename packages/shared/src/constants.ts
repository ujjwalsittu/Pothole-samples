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
  /** Real minimum acceptable average speed. */
  MIN_KMPH: 60,
  /** Real maximum acceptable speed — exceeding this rejects the sample. */
  MAX_KMPH: 65,
  /**
   * The speedometer shown to the user is capped at this value; the user is
   * only ever told the limit is 60 km/h. Validation still uses MIN/MAX.
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

/** Initial package offered on signup. */
export const DEFAULT_PACKAGE = {
  code: 'STARTER_1000',
  name: 'Starter Package',
  /** Complete EITHER quota to earn the payout. */
  videoQuota: 10, // pothole videos on a moving road
  photoQuota: 20, // pothole photos
  payoutInr: 1000,
  currency: 'INR',
} as const;

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

export const UPLOAD = {
  MAX_PHOTO_BYTES: 25 * 1024 * 1024,
  MAX_VIDEO_BYTES: 500 * 1024 * 1024,
  /** Chunk size for resumable uploads on slow networks. */
  CHUNK_BYTES: 1 * 1024 * 1024,
} as const;
