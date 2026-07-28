/**
 * Minimal typed fetch wrapper for the PotholeCollect API.
 * - Injects the Auth0 access token from SecureStore.
 * - Unwraps the standard ApiOk/ApiErr envelope into data-or-throw.
 */
import * as SecureStore from 'expo-secure-store';
import { CONFIG } from '@/config';
import type { ApiResponse } from '@/shared';

export const TOKEN_KEY = 'pc_access_token';

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

export async function getStoredToken(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(TOKEN_KEY);
  } catch {
    return null;
  }
}

export async function setStoredToken(token: string | null): Promise<void> {
  if (token == null) await SecureStore.deleteItemAsync(TOKEN_KEY);
  else await SecureStore.setItemAsync(TOKEN_KEY, token);
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** Raw string body (e.g. base64 chunk) sent as text/plain instead of JSON. */
  rawBody?: string;
  /** Multipart body (file uploads). Content-Type is left to fetch so the boundary is set. */
  formBody?: FormData;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

/**
 * Performs a request against `${CONFIG.apiUrl}${path}` and returns the
 * unwrapped `data`. Throws ApiError with the server error code on ApiErr
 * envelopes, and code NETWORK / BAD_RESPONSE for transport-level failures.
 */
export async function api<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...(opts.headers ?? {}),
  };
  if (CONFIG.devAuthBypass) {
    headers['x-dev-sub'] = CONFIG.devSub;
    headers['x-dev-email'] = CONFIG.devEmail;
  } else {
    const token = await getStoredToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  let body: string | FormData | undefined;
  if (opts.formBody != null) {
    body = opts.formBody;
  } else if (opts.rawBody != null) {
    headers['Content-Type'] = headers['Content-Type'] ?? 'text/plain';
    body = opts.rawBody;
  } else if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }

  let res: Response;
  try {
    res = await fetch(`${CONFIG.apiUrl}${path}`, {
      method: opts.method ?? 'GET',
      headers,
      body,
      signal: opts.signal,
    });
  } catch (e) {
    throw new ApiError('NETWORK', e instanceof Error ? e.message : 'Network request failed', 0);
  }

  let json: ApiResponse<T>;
  try {
    json = (await res.json()) as ApiResponse<T>;
  } catch {
    throw new ApiError('BAD_RESPONSE', `Unexpected response (HTTP ${res.status})`, res.status);
  }

  if (!json.ok) {
    throw new ApiError(json.error.code, json.error.message, res.status);
  }
  return json.data;
}

/** True for errors worth retrying automatically (transport / 5xx / 429). */
export function isRetryable(err: unknown): boolean {
  if (!(err instanceof ApiError)) return false;
  return err.code === 'NETWORK' || err.status >= 500 || err.status === 429;
}
