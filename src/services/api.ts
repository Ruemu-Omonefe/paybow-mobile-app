import { DEFAULT_API_URL, REQUEST_TIMEOUT_MS } from '../config';
import { getMeta, setMeta } from '../db/db';
import { SignedTransaction, TxStatus } from '../lib/protocol';

export class ApiError extends Error {
  constructor(public status: number, message: string, public network = false) {
    super(message);
  }
  /** true for failures that should be retried later with the SAME transaction_id */
  get temporary() {
    return this.network || this.status >= 500 || this.status === 429;
  }
}

let baseUrl = DEFAULT_API_URL;
let token: string | null = null;
let deviceId = 'unknown-device';
let forceOffline = false;
let onUnauthorized: (() => void) | null = null;

export async function initApi() {
  baseUrl = (await getMeta('api_url')) || DEFAULT_API_URL;
  let id = await getMeta('device_id');
  if (!id) {
    id = `dev-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
    await setMeta('device_id', id);
  }
  deviceId = id;
}
export const getBaseUrl = () => baseUrl;
export const getDeviceId = () => deviceId;
export async function setBaseUrl(url: string) {
  baseUrl = url.trim().replace(/\/+$/, '') || DEFAULT_API_URL;
  await setMeta('api_url', baseUrl);
}
export const setToken = (t: string | null) => (token = t);
export const setForceOffline = (v: boolean) => (forceOffline = v);
export const setUnauthorizedHandler = (fn: (() => void) | null) => (onUnauthorized = fn);

async function request<T>(method: string, path: string, body?: unknown, timeoutMs = REQUEST_TIMEOUT_MS): Promise<T> {
  if (forceOffline) throw new ApiError(0, 'Offline mode is on', true);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      signal: ctrl.signal,
      headers: {
        'Content-Type': 'application/json',
        'X-Device-Id': deviceId,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let data: any = null;
    try {
      data = await res.json();
    } catch {
      /* non-JSON body */
    }
    if (!res.ok) {
      if (res.status === 401 && token && onUnauthorized) onUnauthorized();
      throw new ApiError(res.status, data?.error || data?.reason || `Request failed (${res.status})`);
    }
    return data as T;
  } catch (e: any) {
    if (e instanceof ApiError) throw e;
    throw new ApiError(0, e?.name === 'AbortError' ? 'Request timed out' : 'Cannot reach the server', true);
  } finally {
    clearTimeout(timer);
  }
}

/* ---------------- endpoint wrappers (see backend README) ---------------- */
export interface AuthUser { id: string; name: string; email: string; account_reference: string; public_key: string | null }
export interface AuthResponse { token: string; user: AuthUser; wallet: { balance: number; currency: string; updated_at: string | null } }

export const api = {
  health: () => request<{ ok: boolean }>('GET', '/api/health', undefined, 4000),
  register: (b: { name: string; email: string; password: string; public_key: string }) => request<AuthResponse>('POST', '/api/auth/register', b),
  login: (b: { email: string; password: string; public_key?: string }) => request<AuthResponse>('POST', '/api/auth/login', b),
  wallet: () => request<{ balance: number; currency: string; updated_at: string }>('GET', '/api/wallet'),
  user: (id: string) => request<{ id: string; name: string; account_reference: string; public_key: string | null }>('GET', `/api/users/${id}`, undefined, 4000),
  submit: (tx: SignedTransaction) => request<SyncResult>('POST', '/api/transactions', tx),
  sync: (transactions: SignedTransaction[]) =>
    request<{ results: SyncResult[]; balance: number; server_time: number }>('POST', '/api/sync', { device_id: deviceId, transactions }),
  transactions: (limit = 50) => request<{ transactions: ServerTx[] }>('GET', `/api/transactions?limit=${limit}`),
};

export interface SyncResult {
  transaction_id: string | null;
  status: TxStatus | 'ERROR';
  reason: string | null;
  duplicate?: boolean;
  retryable?: boolean;
  processed_at: number;
}
export type ServerTx = SignedTransaction & {
  payer_name: string | null;
  recipient_name: string | null;
  status: TxStatus;
  reason: string | null;
  processed_at: number;
  direction: 'IN' | 'OUT';
};
