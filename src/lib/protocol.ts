/**
 * Paybow protocol – MUST stay identical to backend/src/lib/protocol.ts.
 * Everything signed is a canonical string:  <TAG>|JSON.stringify([...fields in fixed order])
 *   certificate : PBC1  [sn, aid, nm, wid, pk, iat, exp]                    (signed by the BACKEND key)
 *   payment     : PB2   [transaction_id, payer_id, payer_name, recipient_id, amount, currency, timestamp, expires_at, reference]
 *   acceptance  : PBA1  [transaction_id, payer_id, recipient_id, amount, currency, accepted_at, reference]
 *   funding     : PBF1  [reference, account_id, amount, currency, verified_at]  (signed by the BACKEND key)
 * Amounts are integer kobo; times are epoch ms; keys/signatures are base64 Ed25519.
 */
import nacl from 'tweetnacl';
import { decodeBase64, decodeUTF8, encodeBase64 } from 'tweetnacl-util';
import { MAX_PAYMENT_KOBO, MIN_PAYMENT_KOBO } from '../config';

export const CURRENCY = 'NGN';
export const RECIPIENT_QR_TTL_MS = 2 * 60 * 1000; // identification QR: very short expiry
export const PAYMENT_QR_TTL_MS = 5 * 60 * 1000; // signed payment QR: one-time, short-lived
export const CLOCK_SKEW_MS = 30 * 1000;

/** Local transaction statuses (report §3.3.4). */
export type TxStatus = 'PENDING_SYNC' | 'SYNCING' | 'CONFIRMED' | 'REJECTED' | 'CONFLICT' | 'EXPIRED' | 'REFUNDED';

export interface Certificate { v: 1; sn: string; aid: string; nm: string; wid: string; pk: string; iat: number; exp: number; sig: string }
export interface Payment {
  transaction_id: string; payer_id: string; payer_name: string; recipient_id: string; amount: number; currency: string;
  timestamp: number; expires_at: number; reference: string; signature: string;
}
export interface Acceptance {
  transaction_id: string; payer_id: string; recipient_id: string; amount: number; currency: string; accepted_at: number;
  reference: string; signature: string; certificate: Certificate;
}
export interface FundingConfirmation {
  reference: string; account_id: string; amount: number; currency: string; status: 'VERIFIED'; verified_at: number; signature: string;
}

export const certPayload = (c: Omit<Certificate, 'sig'>) => 'PBC1|' + JSON.stringify([c.sn, c.aid, c.nm, c.wid, c.pk, c.iat, c.exp]);
export const paymentPayload = (p: Omit<Payment, 'signature'>) =>
  'PB2|' + JSON.stringify([p.transaction_id, p.payer_id, p.payer_name, p.recipient_id, p.amount, p.currency, p.timestamp, p.expires_at, p.reference]);
export const acceptancePayload = (a: Omit<Acceptance, 'signature' | 'certificate'>) =>
  'PBA1|' + JSON.stringify([a.transaction_id, a.payer_id, a.recipient_id, a.amount, a.currency, a.accepted_at, a.reference]);
export const fundingPayload = (f: Omit<FundingConfirmation, 'signature' | 'status'>) =>
  'PBF1|' + JSON.stringify([f.reference, f.account_id, f.amount, f.currency, f.verified_at]);

export function signPayload(payload: string, secretKeyB64: string): string {
  return encodeBase64(nacl.sign.detached(decodeUTF8(payload), decodeBase64(secretKeyB64)));
}
export function verifyPayload(payload: string, sigB64: string, publicKeyB64: string): boolean {
  try {
    return nacl.sign.detached.verify(decodeUTF8(payload), decodeBase64(sigB64), decodeBase64(publicKeyB64));
  } catch {
    return false;
  }
}

/** Identity credential check: backend signature (embedded public key) + validity period. */
export function verifyCertificate(c: Certificate, serverPublicKey: string, at = Date.now(), skewMs = CLOCK_SKEW_MS): boolean {
  if (!c || c.v !== 1) return false;
  if (!verifyPayload(certPayload(c), c.sig, serverPublicKey)) return false;
  return at >= c.iat - skewMs && at <= c.exp + skewMs;
}

export const signPayment = (p: Omit<Payment, 'signature'>, sk: string): Payment => ({ ...p, signature: signPayload(paymentPayload(p), sk) });
export const verifyPayment = (p: Payment, pk: string) => verifyPayload(paymentPayload(p), p.signature, pk);

export function signAcceptance(p: Payment, cert: Certificate, sk: string, acceptedAt: number): Acceptance {
  const body = { transaction_id: p.transaction_id, payer_id: p.payer_id, recipient_id: p.recipient_id, amount: p.amount, currency: p.currency, accepted_at: acceptedAt, reference: p.reference };
  return { ...body, signature: signPayload(acceptancePayload(body), sk), certificate: cert };
}

export function verifyFundingConfirmation(c: FundingConfirmation, serverPublicKey: string): boolean {
  return c.status === 'VERIFIED' && verifyPayload(fundingPayload(c), c.signature, serverPublicKey);
}

const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
/** Unique reference / nonce for identification QR codes (24 hex chars). */
export const newReference = () => hex(nacl.randomBytes(12));
/** RFC 4122 version-4 UUID from a secure random source. */
export function newTransactionId(): string {
  const b = nacl.randomBytes(16);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = hex(b);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/* ---------------------------------------------------------------- QR payloads (untrusted input) */
const OID = /^[0-9a-f]{24}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const REF = /^[0-9a-f]{16,64}$/;
const WALLET = /^PBW[0-9]{9}$/;

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };
const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });
const b64len = (s: unknown, n: number) => { try { return typeof s === 'string' && decodeBase64(s).length === n; } catch { return false; } };

// certificates travel in the QR as compact arrays: [sn, aid, nm, wid, pk, iat, exp, sig]
const certToArray = (c: Certificate) => [c.sn, c.aid, c.nm, c.wid, c.pk, c.iat, c.exp, c.sig];
function certFromArray(a: any): Certificate | null {
  if (!Array.isArray(a) || a.length !== 8) return null;
  const [sn, aid, nm, wid, pk, iat, exp, sig] = a;
  if (typeof sn !== 'string' || !OID.test(String(aid)) || typeof nm !== 'string' || nm.length < 1 || nm.length > 60 || !WALLET.test(String(wid))) return null;
  if (!b64len(pk, 32) || !b64len(sig, 64) || !Number.isSafeInteger(iat) || !Number.isSafeInteger(exp)) return null;
  return { v: 1, sn, aid, nm, wid, pk, iat, exp, sig };
}

function parseJson(raw: string): any {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** Identification QR (receiver): account ID, registered name, unique reference/nonce, expiry, backend-signed identity credential. */
export interface RecipientIdentity { id: string; name: string; walletId: string; reference: string; expiresAt: number; certificate: Certificate }

export function encodeRecipientQR(r: { id: string; name: string; reference: string; expiresAt: number; certificate: Certificate }): string {
  return JSON.stringify({ v: 2, t: 'R', rid: r.id, nm: r.name, n: r.reference, x: r.expiresAt, c: certToArray(r.certificate) });
}

/** Validates QR format, QR expiry and the identity credential's digital signature (embedded verification key). */
export function parseRecipientQR(raw: string, serverPublicKey: string, now = Date.now()): ParseResult<RecipientIdentity> {
  const q = parseJson(raw);
  if (!q || q.v !== 2 || q.t !== 'R') return fail('This is not a Paybow receiving QR code.');
  const cert = certFromArray(q.c);
  if (!cert || !OID.test(String(q.rid)) || !REF.test(String(q.n)) || !Number.isSafeInteger(q.x) || typeof q.nm !== 'string') return fail('Malformed receiving QR code.');
  if (now > q.x + CLOCK_SKEW_MS) return fail('This QR code has expired. Ask the receiver to refresh it.');
  if (!verifyCertificate(cert, serverPublicKey, now)) return fail("The receiver's identity credential is invalid or expired.");
  if (cert.aid !== q.rid || cert.nm !== q.nm) return fail("The receiver's details do not match their identity credential.");
  return { ok: true, value: { id: cert.aid, name: cert.nm, walletId: cert.wid, reference: q.n, expiresAt: q.x, certificate: cert } };
}

/** Payment QR (sender): transaction ID, sender ID + name, receiver ID, amount, currency, timestamp, expiry, signature + sender certificate. */
export function encodePaymentQR(p: Payment, cert: Certificate): string {
  return JSON.stringify({
    v: 2, t: 'P',
    p: [p.transaction_id, p.payer_id, p.payer_name, p.recipient_id, p.amount, p.currency, p.timestamp, p.expires_at, p.reference, p.signature],
    c: certToArray(cert),
  });
}

/** Structural parse only – signature, certificate, expiry and receiver checks are done by the caller. */
export function parsePaymentQR(raw: string): ParseResult<{ payment: Payment; certificate: Certificate }> {
  const q = parseJson(raw);
  if (!q || q.v !== 2 || q.t !== 'P' || !Array.isArray(q.p) || q.p.length !== 10) return fail('This is not a Paybow payment QR code.');
  const [transaction_id, payer_id, payer_name, recipient_id, amount, currency, timestamp, expires_at, reference, signature] = q.p;
  const cert = certFromArray(q.c);
  const valid =
    cert && UUID.test(String(transaction_id)) && OID.test(String(payer_id)) && OID.test(String(recipient_id)) &&
    typeof payer_name === 'string' && payer_name.length >= 1 && payer_name.length <= 60 &&
    Number.isSafeInteger(amount) && amount > 0 && currency === CURRENCY &&
    Number.isSafeInteger(timestamp) && Number.isSafeInteger(expires_at) && REF.test(String(reference)) && b64len(signature, 64);
  if (!valid || !cert) return fail('Malformed payment QR code.');
  return { ok: true, value: { payment: { transaction_id, payer_id, payer_name, recipient_id, amount, currency, timestamp, expires_at, reference, signature }, certificate: cert } };
}

/** Amount rule shared by sender-side and receiver-side checks. */
export const isValidAmount = (kobo: number) => Number.isSafeInteger(kobo) && kobo >= MIN_PAYMENT_KOBO && kobo <= MAX_PAYMENT_KOBO;
