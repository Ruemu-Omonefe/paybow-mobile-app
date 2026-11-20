import { DEFAULT_API_URL, REQUEST_TIMEOUT_MS } from '../config';
import { getMeta, setMeta } from '../db/db';
import { Acceptance, Certificate, FundingConfirmation, Payment } from '../lib/protocol';

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
      if (res.status === 401 && token && path !== '/api/auth/logout' && onUnauthorized) onUnauthorized();
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
export interface AuthUser { id: string; name: string; email: string; wallet_id: string; public_key: string | null; has_payment_pin: boolean }
export interface LoginResponse { token: string; user: AuthUser; certificate: Certificate | null; wallet: { wallet_id: string; balance: number; currency: string } }

export interface SubmittedTx extends Payment { payer_certificate: Certificate; acceptance?: Acceptance; dependencies?: string[] }
export interface TxResult {
  transaction_id: string | null;
  status: 'CONFIRMED' | 'REJECTED' | 'CONFLICT' | 'REFUNDED' | 'UNRESOLVED' | 'DEFERRED' | 'ERROR';
  reason: string | null;
  duplicate?: boolean;
  retryable?: boolean;
  processed_at?: number;
  refund?: { reference: string; amount: number; refunded_at: number } | null;
}
export interface FundingResult { reference: string | null; status: 'CONFIRMED' | 'REJECTED' | 'ERROR'; reason: string | null; duplicate?: boolean; retryable?: boolean }
export interface SyncResponse { funding_results: FundingResult[]; results: TxResult[]; balance: number; server_time: number }

export const api = {
  health: () => request<{ ok: boolean }>('GET', '/api/health', undefined, 4000),
  register: (b: { name: string; email: string; password: string; payment_pin: string }) =>
    request<{ user: AuthUser; wallet: { wallet_id: string; balance: number } }>('POST', '/api/auth/register', b),
  login: (b: { email: string; password: string; public_key?: string }) => request<LoginResponse>('POST', '/api/auth/login', b),
  logout: () => request<{ ok: boolean }>('POST', '/api/auth/logout'),
  setupPaymentPin: (pin: string) => request<{ has_payment_pin: boolean }>('POST', '/api/auth/payment-pin/setup', { pin }),
  verifyPaymentPin: (pin: string) => request<{ valid: boolean }>('POST', '/api/auth/payment-pin/verify', { pin }),
  certificate: (public_key: string) => request<{ certificate: Certificate }>('POST', '/api/auth/certificate', { public_key }),
  wallet: () => request<{ balance: number; currency: string }>('GET', '/api/wallet'),
  fundingInitiate: (amount: number) => request<{ funding: { reference: string; amount: number } }>('POST', '/api/funding/initiate', { amount }),
  fundingSimulate: (reference: string) => request<{ funding: unknown }>('POST', '/api/funding/simulate', { reference }),
  fundingVerify: (reference: string) => request<{ confirmation: FundingConfirmation }>('POST', '/api/funding/verify', { reference }),
  sync: (b: { funding: { reference: string; amount: number }[]; transactions: SubmittedTx[]; complete: boolean }) =>
    request<SyncResponse>('POST', '/api/sync', { device_id: deviceId, ...b }, 15000),
};
