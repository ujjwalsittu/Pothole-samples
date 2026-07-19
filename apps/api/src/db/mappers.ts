/* eslint-disable @typescript-eslint/no-explicit-any */
import type {
  Annotation,
  AuditLogEntry,
  Campaign,
  LedgerEntry,
  PackageInfo,
  Sample,
  Settlement,
  SettlementConfirmState,
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

/** Annotation + server-side extras (map-matching corrections). */
export type AnnotationOut = Annotation & {
  correctedLat: number | null;
  correctedLng: number | null;
  correctionSource: string | null;
};

export function rowToAnnotation(r: Row): AnnotationOut {
  return {
    id: r.id,
    sampleId: r.sample_id,
    label: r.label,
    status: r.status ?? 'pending',
    createdBy: r.created_by ?? 'collector',
    polygon: r.polygon ?? [],
    videoTimeSec: numOrNull(r.video_time_sec),
    lat: num(r.lat),
    lng: num(r.lng),
    estimate: r.estimate ?? null,
    correctedLat: numOrNull(r.corrected_lat),
    correctedLng: numOrNull(r.corrected_lng),
    correctionSource: r.correction_source ?? null,
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

/** Settlement + two-admin confirmation extras. */
export type SettlementOut = Settlement & {
  confirmState: SettlementConfirmState | null;
  initiatedBy: string | null;
  confirmedBy: string | null;
  confirmedAt: string | null;
};

export function rowToSettlement(r: Row): SettlementOut {
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
    confirmState: (r.confirm_state ?? null) as SettlementConfirmState | null,
    initiatedBy: r.initiated_by ?? null,
    confirmedBy: r.confirmed_by ?? null,
    confirmedAt: iso(r.confirmed_at),
  };
}

export function rowToPackage(r: Row): PackageInfo {
  return {
    code: r.code,
    name: r.name,
    videoQuota: num(r.video_quota),
    photoQuota: num(r.photo_quota),
    payoutInr: num(r.payout_inr),
    active: r.active == null ? true : Boolean(r.active),
    nextPackageCode: r.next_package_code ?? null,
  };
}

export function rowToCampaign(r: Row): Campaign {
  return {
    id: r.id,
    name: r.name,
    description: r.description ?? null,
    polygon: r.polygon ?? [],
    boost: num(r.boost),
    active: Boolean(r.active),
    startsAt: iso(r.starts_at),
    endsAt: iso(r.ends_at),
    createdAt: iso(r.created_at) as string,
  };
}

export function rowToAuditEntry(r: Row): AuditLogEntry {
  return {
    id: r.id,
    actorId: r.actor_id,
    actorName: r.actor_name ?? '',
    action: r.action,
    targetType: r.target_type,
    targetId: r.target_id ?? '',
    detail: r.detail ?? null,
    createdAt: iso(r.created_at) as string,
  };
}
