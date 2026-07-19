/* eslint-disable @typescript-eslint/no-explicit-any */
import type {
  Annotation,
  LedgerEntry,
  Sample,
  Settlement,
  User,
} from '@pothole/shared';

type Row = Record<string, any>;

const iso = (v: any): string | null => (v == null ? null : new Date(v).toISOString());
const num = (v: any): number => (v == null ? 0 : Number(v));
const numOrNull = (v: any): number | null => (v == null ? null : Number(v));

export function rowToUser(r: Row): User {
  return {
    id: r.id,
    auth0Sub: r.auth0_sub,
    email: r.email,
    fullName: r.full_name,
    photoUrl: r.photo_url ?? null,
    role: r.role,
    collectorStatus: r.collector_status,
    upiId: r.upi_id ?? null,
    accountState: r.account_state,
    packageCode: r.package_code,
    createdAt: iso(r.created_at) as string,
    approvedAt: iso(r.approved_at),
  };
}

export function rowToSample(r: Row): Sample {
  return {
    id: r.id,
    userId: r.user_id,
    mediaType: r.media_type,
    state: r.state,
    sha256: r.sha256,
    phash: r.phash ?? null,
    capturedAt: iso(r.captured_at) as string,
    durationSec: numOrNull(r.duration_sec),
    avgSpeedKmph: numOrNull(r.avg_speed_kmph),
    maxSpeedKmph: numOrNull(r.max_speed_kmph),
    lat: num(r.lat),
    lng: num(r.lng),
    gpsAccuracyM: num(r.gps_accuracy_m),
    mockLocationDetected: Boolean(r.mock_location_detected),
    potholeCount: num(r.pothole_count),
    rejectionReason: r.rejection_reason ?? null,
    reviewedBy: r.reviewed_by ?? null,
    reviewedAt: iso(r.reviewed_at),
    mediaUrl: r.media_path ? `/api/v1/media/${r.id}` : null,
    createdAt: iso(r.created_at) as string,
  };
}

export function rowToAnnotation(r: Row): Annotation {
  return {
    id: r.id,
    sampleId: r.sample_id,
    label: r.label,
    polygon: r.polygon ?? [],
    videoTimeSec: numOrNull(r.video_time_sec),
    lat: num(r.lat),
    lng: num(r.lng),
    estimate: r.estimate ?? null,
  };
}

export function rowToLedgerEntry(r: Row): LedgerEntry & { settled: boolean; settledAt: string | null } {
  return {
    id: r.id,
    userId: r.user_id,
    type: r.type,
    amountInr: num(r.amount_inr),
    sampleId: r.sample_id ?? null,
    settlementId: r.settlement_id ?? null,
    note: r.note ?? null,
    balanceInr: num(r.balance_inr),
    settled: Boolean(r.settled),
    settledAt: iso(r.settled_at),
    createdAt: iso(r.created_at) as string,
  };
}

export function rowToSettlement(r: Row): Settlement {
  return {
    id: r.id,
    userId: r.user_id,
    amountInr: num(r.amount_inr),
    state: r.state,
    settledBy: r.settled_by ?? null,
    settledAt: iso(r.settled_at),
    proofUrl: r.proof_path ?? null,
    utrReference: r.utr_reference ?? null,
    createdAt: iso(r.created_at) as string,
  };
}
