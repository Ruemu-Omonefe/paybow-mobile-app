/**
 * Paybow transaction protocol – MUST stay identical to backend/src/lib/protocol.js.
 * Canonical string signed by the payer's device (Ed25519):
 *   PB1|transaction_id|payer_id|recipient_id|amount|currency|timestamp|nonce|expires_at
 * amount = integer kobo; timestamp / expires_at = epoch milliseconds.
 */
import nacl from './nacl';
import { decodeBase64, decodeUTF8, encodeBase64 } from 'tweetnacl-util';

export const CURRENCY = 'NGN';
export const RECIPIENT_QR_TTL_MS = 2 * 60 * 1000; // recipient QR: very short expiry
export const PAYMENT_QR_TTL_MS = 5 * 60 * 1000; // signed payment QR: one-time, short-lived
export const CLOCK_SKEW_MS = 30 * 1000;

export type TxStatus = 'PENDING' | 'SYNCING' | 'ACCEPTED' | 'REJECTED' | 'CONFLICT';

export interface SignedTransaction {
  transaction_id: string;
  payer_id: string;
  recipient_id: string;
  amount: number;
  currency: string;
  timestamp: number;
  nonce: string;
  expires_at: number;
  signature: string;
}

export function canonicalPayload(t: Omit<SignedTransaction, 'signature'>): string {
  return ['PB1', t.transaction_id, t.payer_id, t.recipient_id, t.amount, t.currency, t.timestamp, t.nonce, t.expires_at].join('|');
}

export function signTransaction(t: Omit<SignedTransaction, 'signature'>, secretKeyB64: string): SignedTransaction {
  const sig = nacl.sign.detached(decodeUTF8(canonicalPayload(t)), decodeBase64(secretKeyB64));
  return { ...t, signature: encodeBase64(sig) };
}

export function verifyTransaction(t: SignedTransaction, publicKeyB64: string): boolean {
  try {
    return nacl.sign.detached.verify(decodeUTF8(canonicalPayload(t)), decodeBase64(t.signature), decodeBase64(publicKeyB64));
  } catch {
    return false;
  }
}

const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

export function newNonce(): string {
  return hex(nacl.randomBytes(12)); // 24 hex chars
}

/** RFC 4122 version-4 UUID from a secure random source. */
export function newTransactionId(): string {
  const b = nacl.randomBytes(16);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = hex(b);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/* ---------------------------------------------------------------- QR payloads (untrusted input) */

/** Recipient QR: receiver id + very short expiry + nonce (+ display-name hint). No secrets. */
export interface RecipientQR {
  v: 1;
  t: 'R';
  rid: string;
  nm: string;
  n: string;
  x: number;
}

/** Payment QR: transaction details + payer signature (+ display hints). No private key / PIN. */
export interface PaymentQR {
  v: 1;
  t: 'P';
  tx: SignedTransaction;
  pn: string; // payer display name (hint – registered name is confirmed by the server)
  pk: string; // payer public key (hint – the server verifies against the REGISTERED key)
}

const OID = /^[0-9a-f]{24}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const NONCE = /^[0-9a-f]{16,64}$/;

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

export function encodeRecipientQR(q: Omit<RecipientQR, 'v' | 't'>): string {
  return JSON.stringify({ v: 1, t: 'R', ...q });
}
export function encodePaymentQR(tx: SignedTransaction, pn: string, pk: string): string {
  return JSON.stringify({ v: 1, t: 'P', tx, pn, pk } satisfies PaymentQR);
}

function parseJson(raw: string): any {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function parseRecipientQR(raw: string, now = Date.now()): ParseResult<RecipientQR> {
  const q = parseJson(raw);
  if (!q || q.v !== 1 || q.t !== 'R') return { ok: false, error: 'This is not a Paybow recipient QR code.' };
  if (!OID.test(String(q.rid)) || !NONCE.test(String(q.n)) || !Number.isSafeInteger(q.x))
    return { ok: false, error: 'Malformed recipient QR code.' };
  if (now > q.x + CLOCK_SKEW_MS) return { ok: false, error: 'This QR code has expired. Ask the receiver to refresh it.' };
  return { ok: true, value: { v: 1, t: 'R', rid: q.rid, nm: String(q.nm || '').slice(0, 60), n: q.n, x: q.x } };
}

export function parsePaymentQR(raw: string, now = Date.now()): ParseResult<PaymentQR> {
  const q = parseJson(raw);
  if (!q || q.v !== 1 || q.t !== 'P' || !q.tx) return { ok: false, error: 'This is not a Paybow payment QR code.' };
  const t = q.tx;
  const valid =
    UUID.test(String(t.transaction_id)) &&
    OID.test(String(t.payer_id)) &&
    OID.test(String(t.recipient_id)) &&
    Number.isSafeInteger(t.amount) && t.amount > 0 &&
    t.currency === CURRENCY &&
    Number.isSafeInteger(t.timestamp) &&
    Number.isSafeInteger(t.expires_at) &&
    NONCE.test(String(t.nonce)) &&
    typeof t.signature === 'string' && t.signature.length === 88 &&
    typeof q.pk === 'string';
  if (!valid) return { ok: false, error: 'Malformed payment QR code.' };
  if (now > t.expires_at + CLOCK_SKEW_MS) return { ok: false, error: 'This payment QR code has expired. Ask the payer to create a new one.' };
  const tx: SignedTransaction = {
    transaction_id: t.transaction_id, payer_id: t.payer_id, recipient_id: t.recipient_id, amount: t.amount,
    currency: t.currency, timestamp: t.timestamp, nonce: t.nonce, expires_at: t.expires_at, signature: t.signature,
  };
  return { ok: true, value: { v: 1, t: 'P', tx, pn: String(q.pn || '').slice(0, 60), pk: q.pk } };
}
