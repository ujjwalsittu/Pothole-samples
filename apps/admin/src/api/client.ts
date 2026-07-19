import type {
  Annotation,
  AnnotationStatus,
  ApiResponse,
  AuditLogEntry,
  Campaign,
  DatasetManifest,
  GpsPoint,
  LeaderboardEntry,
  LedgerEntry,
  ModelRelease,
  OsrmStatus,
  PackageInfo,
  PolygonPoint,
  PotholeEstimate,
  RoadQualityCell,
  Sample,
  SampleState,
  Settlement,
  SettlementConfirmState,
  User,
} from '@pothole/shared';

/* ------------------------------------------------------------------ */
/* Configuration                                                       */
/* ------------------------------------------------------------------ */

export const API_URL: string = (import.meta.env.VITE_API_URL || 'http://localhost:4000').replace(
  /\/+$/,
  '',
);

export const DEV_BYPASS: boolean = !import.meta.env.VITE_AUTH0_DOMAIN;

type TokenGetter = () => Promise<string | null>;

let tokenGetter: TokenGetter = async () => null;

/** Called once by the auth provider so the client can attach tokens. */
export function configureApiAuth(getToken: TokenGetter): void {
  tokenGetter = getToken;
}

/* ------------------------------------------------------------------ */
/* Errors                                                              */
/* ------------------------------------------------------------------ */

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

export function isApiError(err: unknown): err is ApiError {
  return err instanceof ApiError;
}

export function errorMessage(err: unknown): string {
  if (isApiError(err)) return err.message || err.code;
  if (err instanceof Error) return err.message;
  return String(err);
}

/* ------------------------------------------------------------------ */
/* Core fetch                                                          */
/* ------------------------------------------------------------------ */

async function authHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = {};
  if (DEV_BYPASS) {
    headers['x-dev-sub'] = import.meta.env.VITE_DEV_SUB || 'dev|admin';
    headers['x-dev-email'] = import.meta.env.VITE_DEV_EMAIL || 'admin@dev.local';
  } else {
    const token = await tokenGetter();
    if (token) headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

export async function authedFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  const auth = await authHeaders();
  for (const [k, v] of Object.entries(auth)) headers.set(k, v);
  return fetch(`${API_URL}${path}`, { ...init, headers });
}

async function parseEnvelope<T>(res: Response): Promise<T> {
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    /* non-JSON body */
  }
  const envelope = body as Partial<ApiResponse<T>> | null;
  if (envelope && envelope.ok === true && 'data' in envelope) {
    return (envelope as { data: T }).data;
  }
  if (envelope && envelope.ok === false && envelope.error) {
    const e = envelope.error as { code?: string; message?: string };
    throw new ApiError(e.code || 'UNKNOWN', e.message || 'Request failed', res.status);
  }
  if (!res.ok) {
    throw new ApiError(`HTTP_${res.status}`, `Request failed with status ${res.status}`, res.status);
  }
  // Tolerate a bare (non-enveloped) success payload.
  return body as T;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await authedFetch(path, init);
  } catch (err) {
    throw new ApiError('NETWORK', `Cannot reach API at ${API_URL} (${errorMessage(err)})`, 0);
  }
  return parseEnvelope<T>(res);
}

function jsonInit(method: string, body?: unknown): RequestInit {
  return {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  };
}

/* ------------------------------------------------------------------ */
/* Admin-facing shapes (tolerant of small API variations)              */
/* ------------------------------------------------------------------ */

/** Sample row in admin lists — includes user info attached by the API. */
export type AdminSampleRow = Sample & {
  user?: Partial<User> | null;
  userName?: string;
  userEmail?: string;
};

export interface GpsTrack {
  recordingStartMs: number;
  points: GpsPoint[];
}

export interface SampleDetail {
  sample: AdminSampleRow;
  annotations: Annotation[];
  gpsTrack: GpsTrack | null;
}

export interface BalanceInfo {
  earnedInr: number;
  settledInr: number;
  balanceInr: number;
}

export type SettlementRow = Settlement & {
  user?: Partial<User> | null;
  userName?: string;
  userEmail?: string;
  /** Two-admin confirmation flow (≥ ₹5000). */
  confirmState?: SettlementConfirmState | null;
  initiatedBy?: string | null;
  initiatedByName?: string | null;
  confirmedBy?: string | null;
  confirmedByName?: string | null;
};

export function sampleUserLabel(row: AdminSampleRow | null | undefined): string {
  if (!row) return 'Unknown';
  return row.user?.fullName || row.userName || row.user?.email || row.userEmail || row.userId || 'Unknown';
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function asArray(data: unknown): any[] {
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object') {
    const obj = data as Record<string, unknown>;
    for (const key of [
      'items',
      'rows',
      'users',
      'samples',
      'settlements',
      'entries',
      'ledger',
      'campaigns',
      'packages',
      'datasets',
      'cells',
      'leaderboard',
      'audit',
    ]) {
      if (Array.isArray(obj[key])) return obj[key] as any[];
    }
  }
  return [];
}

function normalizeBalance(data: unknown): BalanceInfo {
  const obj = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
  const num = (...keys: string[]): number => {
    for (const k of keys) {
      const v = obj[k];
      if (typeof v === 'number' && Number.isFinite(v)) return v;
    }
    return 0;
  };
  return {
    earnedInr: num('earnedInr', 'earned', 'totalEarnedInr'),
    settledInr: num('settledInr', 'settled', 'totalSettledInr'),
    balanceInr: num('balanceInr', 'balance', 'payableInr'),
  };
}

function normalizeSampleDetail(data: unknown): SampleDetail {
  const obj = (data && typeof data === 'object' ? data : {}) as Record<string, any>;
  const sample: AdminSampleRow = (obj.sample ?? obj) as AdminSampleRow;
  const rawAnnotations: any[] = Array.isArray(obj.annotations)
    ? obj.annotations
    : Array.isArray(sample && (sample as any).annotations)
      ? (sample as any).annotations
      : [];
  // Tolerate rows missing the newer status/createdBy fields.
  const annotations: Annotation[] = rawAnnotations.map((a) => ({
    status: 'pending',
    createdBy: 'collector',
    ...a,
  }));
  let gpsTrack: GpsTrack | null = null;
  const rawTrack = obj.gpsTrack ?? (sample as any)?.gpsTrack ?? null;
  if (rawTrack && typeof rawTrack === 'object') {
    if (Array.isArray(rawTrack)) {
      gpsTrack = { recordingStartMs: rawTrack[0]?.t ?? 0, points: rawTrack };
    } else if (Array.isArray(rawTrack.points)) {
      gpsTrack = {
        recordingStartMs:
          typeof rawTrack.recordingStartMs === 'number'
            ? rawTrack.recordingStartMs
            : (rawTrack.points[0]?.t ?? 0),
        points: rawTrack.points,
      };
    }
  }
  return { sample, annotations, gpsTrack };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/* ------------------------------------------------------------------ */
/* Endpoints                                                           */
/* ------------------------------------------------------------------ */

export function getVersion(): Promise<{ version?: string } & Record<string, unknown>> {
  return request('/api/v1/version');
}

export function getMe(): Promise<User> {
  return request<User>('/api/v1/me');
}

export async function listUsers(
  state: 'pending_approval' | 'approved' | 'rejected',
): Promise<User[]> {
  const data = await request<unknown>(`/api/v1/admin/users?state=${state}`);
  return asArray(data) as User[];
}

export function approveUser(id: string): Promise<unknown> {
  return request(`/api/v1/admin/users/${id}/approve`, jsonInit('POST', {}));
}

export function rejectUser(id: string, reason: string): Promise<unknown> {
  return request(`/api/v1/admin/users/${id}/reject`, jsonInit('POST', { reason }));
}

export function patchUser(
  id: string,
  patch: { collectorStatus?: string; role?: string; packageCode?: string },
): Promise<unknown> {
  return request(`/api/v1/admin/users/${id}`, jsonInit('PATCH', patch));
}

export async function listSamples(
  state: Extract<
    SampleState,
    'pending_review' | 'accepted' | 'partially_accepted' | 'rejected' | 'auto_rejected'
  >,
): Promise<AdminSampleRow[]> {
  const data = await request<unknown>(`/api/v1/admin/samples?state=${state}`);
  return asArray(data) as AdminSampleRow[];
}

export async function getSampleDetail(id: string): Promise<SampleDetail> {
  const data = await request<unknown>(`/api/v1/admin/samples/${id}`);
  return normalizeSampleDetail(data);
}

export type ReviewDecision = 'accepted' | 'partially_accepted' | 'rejected';

export function reviewSample(id: string, decision: ReviewDecision, reason?: string): Promise<unknown> {
  return request(`/api/v1/admin/samples/${id}/review`, jsonInit('POST', { decision, reason }));
}

/* ---------------- annotation editing ---------------- */

export interface AnnotationCreateBody {
  label: string;
  polygon: PolygonPoint[];
  videoTimeSec?: number;
  estimate?: PotholeEstimate;
}

export interface AnnotationPatchBody {
  label?: string;
  polygon?: PolygonPoint[];
  videoTimeSec?: number;
  status?: AnnotationStatus;
}

/** Tolerant: the API may return the annotation bare or wrapped. */
function normalizeAnnotation(data: unknown, fallback: Annotation): Annotation {
  const obj = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
  const raw = (obj.annotation && typeof obj.annotation === 'object' ? obj.annotation : obj) as Partial<Annotation>;
  return {
    ...fallback,
    ...raw,
    id: typeof raw.id === 'string' && raw.id ? raw.id : fallback.id,
    polygon: Array.isArray(raw.polygon) ? raw.polygon : fallback.polygon,
  };
}

export async function createAnnotation(
  sampleId: string,
  body: AnnotationCreateBody,
  fallback: Annotation,
): Promise<Annotation> {
  const data = await request<unknown>(
    `/api/v1/admin/samples/${sampleId}/annotations`,
    jsonInit('POST', body),
  );
  return normalizeAnnotation(data, fallback);
}

export function patchAnnotation(annotationId: string, body: AnnotationPatchBody): Promise<unknown> {
  return request(`/api/v1/admin/annotations/${annotationId}`, jsonInit('PATCH', body));
}

export function deleteAnnotation(annotationId: string): Promise<unknown> {
  return request(`/api/v1/admin/annotations/${annotationId}`, { method: 'DELETE' });
}

export async function listSettlements(): Promise<SettlementRow[]> {
  const data = await request<unknown>('/api/v1/admin/settlements');
  return asArray(data) as SettlementRow[];
}

export async function getUserBalance(id: string): Promise<BalanceInfo> {
  const data = await request<unknown>(`/api/v1/admin/users/${id}/balance`);
  return normalizeBalance(data);
}

export async function createSettlement(
  userId: string,
  opts: { amountInr: number; utrReference: string; proof: File | null },
): Promise<unknown> {
  const form = new FormData();
  form.append('amountInr', String(opts.amountInr));
  form.append('utrReference', opts.utrReference);
  if (opts.proof) form.append('proof', opts.proof, opts.proof.name);
  // NOTE: do not set Content-Type — the browser adds the multipart boundary.
  return request(`/api/v1/admin/users/${userId}/settlements`, { method: 'POST', body: form });
}

export function confirmSettlement(settlementId: string): Promise<unknown> {
  return request(`/api/v1/admin/settlements/${settlementId}/confirm`, jsonInit('POST', {}));
}

export function cancelSettlement(settlementId: string): Promise<unknown> {
  return request(`/api/v1/admin/settlements/${settlementId}/cancel`, jsonInit('POST', {}));
}

/* ---------------- campaigns ---------------- */

export interface CampaignBody {
  name: string;
  description: string | null;
  polygon: Array<{ lat: number; lng: number }>;
  boost: number;
  active: boolean;
  startsAt: string | null;
  endsAt: string | null;
}

export async function listCampaigns(): Promise<Campaign[]> {
  const data = await request<unknown>('/api/v1/admin/campaigns');
  return asArray(data) as Campaign[];
}

export function createCampaign(body: CampaignBody): Promise<unknown> {
  return request('/api/v1/admin/campaigns', jsonInit('POST', body));
}

export function updateCampaign(id: string, body: Partial<CampaignBody>): Promise<unknown> {
  return request(`/api/v1/admin/campaigns/${id}`, jsonInit('PATCH', body));
}

export function deleteCampaign(id: string): Promise<unknown> {
  return request(`/api/v1/admin/campaigns/${id}`, { method: 'DELETE' });
}

/* ---------------- leaderboard / road quality / audit ---------------- */

export async function getLeaderboard(period: 'month' | 'all'): Promise<LeaderboardEntry[]> {
  const data = await request<unknown>(`/api/v1/leaderboard?period=${period}`);
  return asArray(data) as LeaderboardEntry[];
}

export async function getRoadQuality(): Promise<RoadQualityCell[]> {
  const data = await request<unknown>('/api/v1/admin/road-quality');
  return asArray(data) as RoadQualityCell[];
}

export async function getAuditLog(opts: {
  limit?: number;
  before?: string;
  action?: string;
}): Promise<AuditLogEntry[]> {
  const params = new URLSearchParams();
  if (opts.limit) params.set('limit', String(opts.limit));
  if (opts.before) params.set('before', opts.before);
  if (opts.action) params.set('action', opts.action);
  const qs = params.toString();
  const data = await request<unknown>(`/api/v1/admin/audit${qs ? `?${qs}` : ''}`);
  return asArray(data) as AuditLogEntry[];
}

/* ---------------- datasets / post-processing ---------------- */

export async function listDatasets(): Promise<DatasetManifest[]> {
  const data = await request<unknown>('/api/v1/admin/datasets');
  return asArray(data) as DatasetManifest[];
}

export function datasetManifestPath(id: string): string {
  return `/api/v1/admin/datasets/${id}/manifest.json`;
}

export function runMapMatch(sampleIds?: string[]): Promise<Record<string, unknown>> {
  return request(
    '/api/v1/admin/postprocess/map-match',
    jsonInit('POST', sampleIds && sampleIds.length > 0 ? { sampleIds } : {}),
  );
}

/* ---------------- OSRM service manager ---------------- */

export function getOsrmStatus(): Promise<OsrmStatus> {
  return request<OsrmStatus>('/api/v1/admin/osrm/status');
}

export function osrmDownload(url: string): Promise<unknown> {
  return request('/api/v1/admin/osrm/download', jsonInit('POST', { url }));
}

/** 202-accepted job; poll getOsrmStatus. Throws ApiError OSRM_RUNNER_UNAVAILABLE (501) without binaries/docker. */
export function osrmPreprocess(): Promise<unknown> {
  return request('/api/v1/admin/osrm/preprocess', jsonInit('POST', {}));
}

export function osrmServe(): Promise<unknown> {
  return request('/api/v1/admin/osrm/serve', jsonInit('POST', {}));
}

export function osrmStop(): Promise<unknown> {
  return request('/api/v1/admin/osrm/stop', jsonInit('POST', {}));
}

/* ---------------- model releases (on-device TFLite, OTA) ---------------- */

export async function listModels(): Promise<ModelRelease[]> {
  const data = await request<unknown>('/api/v1/admin/models');
  return asArray(data) as ModelRelease[];
}

export function activateModel(id: string): Promise<unknown> {
  return request(`/api/v1/admin/models/${id}/activate`, jsonInit('POST', {}));
}

/** The release the mobile app currently fetches OTA. 404-tolerant (none published yet). */
export async function getLatestModel(): Promise<ModelRelease | null> {
  try {
    const data = await request<unknown>('/api/v1/models/latest');
    const obj = (data && typeof data === 'object' ? data : null) as ModelRelease | null;
    return obj && typeof obj.id === 'string' ? obj : null;
  } catch (err) {
    if (isApiError(err) && err.status === 404) return null;
    throw err;
  }
}

export interface UploadProgress {
  sentBytes: number;
  totalBytes: number;
}

/** Multipart model upload with real upload progress (XHR — fetch cannot report it). */
export async function uploadModel(
  file: File,
  notes: string,
  onProgress?: (p: UploadProgress) => void,
): Promise<unknown> {
  const headers = await authHeaders();
  const form = new FormData();
  form.append('file', file, file.name);
  form.append('notes', notes);
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API_URL}/api/v1/admin/models`);
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.({ sentBytes: e.loaded, totalBytes: e.total });
    };
    xhr.onerror = () => reject(new ApiError('NETWORK', `Cannot reach API at ${API_URL}`, 0));
    xhr.onload = () => {
      let body: unknown = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        /* non-JSON */
      }
      const env = body as Partial<ApiResponse<unknown>> | null;
      if (env && env.ok === true && 'data' in env) return resolve((env as { data: unknown }).data);
      if (env && env.ok === false && env.error) {
        const e = env.error as { code?: string; message?: string };
        return reject(new ApiError(e.code || 'UNKNOWN', e.message || 'Upload failed', xhr.status));
      }
      if (xhr.status >= 200 && xhr.status < 300) return resolve(body);
      reject(new ApiError(`HTTP_${xhr.status}`, `Upload failed with status ${xhr.status}`, xhr.status));
    };
    xhr.send(form);
  });
}

/* ---------------- packages ---------------- */

export interface PackageBody {
  code: string;
  name: string;
  videoQuota: number;
  photoQuota: number;
  payoutInr: number;
  active: boolean;
  nextPackageCode: string | null;
}

export async function listPackages(): Promise<PackageInfo[]> {
  const data = await request<unknown>('/api/v1/admin/packages');
  return asArray(data) as PackageInfo[];
}

export function createPackage(body: PackageBody): Promise<unknown> {
  return request('/api/v1/admin/packages', jsonInit('POST', body));
}

export function updatePackage(code: string, body: Partial<PackageBody>): Promise<unknown> {
  return request(`/api/v1/admin/packages/${encodeURIComponent(code)}`, jsonInit('PATCH', body));
}

/** Ledger view — tolerant: a 404 (route not mounted) renders as an empty ledger. */
export async function getLedger(userId: string): Promise<LedgerEntry[]> {
  try {
    const data = await request<unknown>(`/api/v1/earnings/ledger?userId=${encodeURIComponent(userId)}`);
    return asArray(data) as LedgerEntry[];
  } catch (err) {
    if (isApiError(err) && err.status === 404) return [];
    throw err;
  }
}

export type ExportBundle = 'training' | 'raw';

export function exportToDrive(bundle: ExportBundle): Promise<
  { folderLink?: string; folderUrl?: string; link?: string; url?: string } & Record<string, unknown>
> {
  return request('/api/v1/admin/export/drive', jsonInit('POST', { bundle }));
}

/* ------------------------------------------------------------------ */
/* Media + binary downloads                                            */
/* ------------------------------------------------------------------ */

/**
 * Fetch an auth-protected media stream and return an object URL.
 * The media route does NOT accept ?access_token= — the Authorization
 * header (or dev-bypass headers) must go on the fetch itself.
 * Caller must revoke the returned URL when done.
 */
export function fetchMediaBlob(sampleId: string): Promise<string> {
  return fetchAuthedBlobUrl(`/api/v1/media/${sampleId}`);
}

async function fetchAuthedBlobUrl(path: string): Promise<string> {
  const res = await authedFetch(path);
  if (!res.ok) {
    throw await parseEnvelope<never>(res).catch((e) =>
      isApiError(e) ? e : new ApiError('MEDIA_FAILED', `Media fetch failed (${res.status})`, res.status),
    );
  }
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

/**
 * Thumbnail blob URLs, cached for the session (object URLs are kept alive
 * so list re-renders never refetch).
 */
const thumbCache = new Map<string, Promise<string>>();

export function fetchThumbBlob(sampleId: string): Promise<string> {
  let p = thumbCache.get(sampleId);
  if (!p) {
    p = fetchAuthedBlobUrl(`/api/v1/media/${sampleId}/thumb`);
    p.catch(() => thumbCache.delete(sampleId)); // allow retry after failures
    thumbCache.set(sampleId, p);
  }
  return p;
}

/** Extracted video frame for a specific annotation. Not cached (rarely re-viewed). */
export function fetchFrameBlob(sampleId: string, annotationId: string): Promise<string> {
  return fetchAuthedBlobUrl(`/api/v1/media/${sampleId}/frames/${annotationId}`);
}

export interface DownloadProgress {
  receivedBytes: number;
  totalBytes: number | null;
}

/** Authenticated binary download → triggers a browser save. Reports progress. */
export async function downloadAuthedFile(
  path: string,
  filename: string,
  onProgress?: (p: DownloadProgress) => void,
): Promise<void> {
  const res = await authedFetch(path);
  if (!res.ok) {
    throw await parseEnvelope<never>(res).catch((e) =>
      isApiError(e) ? e : new ApiError('DOWNLOAD_FAILED', `Download failed (${res.status})`, res.status),
    );
  }
  const lenHeader = res.headers.get('content-length');
  const totalBytes = lenHeader ? Number(lenHeader) : null;
  let blob: Blob;
  if (res.body && typeof res.body.getReader === 'function') {
    const reader = res.body.getReader();
    const chunks: BlobPart[] = [];
    let receivedBytes = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        receivedBytes += value.byteLength;
        onProgress?.({ receivedBytes, totalBytes });
      }
    }
    blob = new Blob(chunks, { type: res.headers.get('content-type') || 'application/octet-stream' });
  } else {
    blob = await res.blob();
    onProgress?.({ receivedBytes: blob.size, totalBytes: blob.size });
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Resolve a possibly-relative proof/media URL against the API base. */
export function resolveApiUrl(url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  return `${API_URL}${url.startsWith('/') ? '' : '/'}${url}`;
}
