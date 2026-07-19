import type {
  Annotation,
  AnnotationStatus,
  ApiResponse,
  GpsPoint,
  LedgerEntry,
  PolygonPoint,
  PotholeEstimate,
  Sample,
  SampleState,
  Settlement,
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
    for (const key of ['items', 'rows', 'users', 'samples', 'settlements', 'entries', 'ledger']) {
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
  patch: { collectorStatus?: string; role?: string },
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
export async function fetchMediaBlob(sampleId: string): Promise<string> {
  const res = await authedFetch(`/api/v1/media/${sampleId}`);
  if (!res.ok) {
    // Media errors may still use the JSON envelope.
    throw await parseEnvelope<never>(res).catch((e) =>
      isApiError(e) ? e : new ApiError('MEDIA_FAILED', `Media fetch failed (${res.status})`, res.status),
    );
  }
  const blob = await res.blob();
  return URL.createObjectURL(blob);
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
