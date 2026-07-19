/**
 * Deterministic dataset split assignment (features 9+10).
 *
 * A sample's split is derived from sha256(userId + ':' + geohash(lat,lng)) —
 * the same collector shooting in the same ~150 m cell ALWAYS lands in the
 * same split, so near-duplicate scenes can never leak between train and
 * val/test. Never random.
 */
import crypto from 'node:crypto';
import { DATASET_SPLIT, geohashEncode, type DatasetSplit } from '@pothole/shared';

export function splitForSample(userId: string, lat: number, lng: number): DatasetSplit {
  const cell = geohashEncode(lat, lng, DATASET_SPLIT.GEO_PRECISION);
  const digest = crypto.createHash('sha256').update(`${userId}:${cell}`).digest();
  // First 4 bytes → uniform fraction in [0, 1).
  const frac = digest.readUInt32BE(0) / 0x1_0000_0000;
  if (frac < DATASET_SPLIT.TRAIN) return 'train';
  if (frac < DATASET_SPLIT.TRAIN + DATASET_SPLIT.VAL) return 'val';
  return 'test';
}
