/**
 * Offline payment flow (spec "Offline QR payment"): receiver-first.
 *  Receiver: receiveQR()  → identification QR (account ID, name, nonce, expiry, backend-signed credential)
 *  Sender  : validateRecipientQr() → confirm name → createPayment() (PIN, atomic) → payment QR
 *  Receiver: acceptIncomingPayment() → validations → atomic auto-credit + signed acceptance.
 */
import { SERVER_PUBLIC_KEY } from '../config';
import * as crypto from '../lib/crypto';
import * as repo from '../db/repo';
import {
  Certificate, CLOCK_SKEW_MS, encodePaymentQR, encodeRecipientQR, isValidAmount, newReference, parsePaymentQR, parseRecipientQR,
  Payment, RecipientIdentity, RECIPIENT_QR_TTL_MS, signAcceptance, signPayment, verifyCertificate, verifyPayment,
} from '../lib/protocol';

export class PayError extends Error {}

async function ownCertificate(userId: string): Promise<Certificate> {
  const cert = await repo.getCertificate(userId);
  if (!cert || !verifyCertificate(cert, SERVER_PUBLIC_KEY)) throw new PayError('Your identity certificate is missing or expired. Connect to the internet once to renew it.');
  return cert;
}

/** Receiver: identification QR. A fresh nonce and a short expiry every time. */
export async function receiveQR(userId: string): Promise<{ qr: string; expiresAt: number; reference: string }> {
  const certificate = await ownCertificate(userId);
  const expiresAt = Date.now() + RECIPIENT_QR_TTL_MS;
  const reference = newReference();
  return { qr: encodeRecipientQR({ id: certificate.aid, name: certificate.nm, reference, expiresAt, certificate }), expiresAt, reference };
}

/** Sender: format, expiry and credential-signature checks on the scanned identification QR. */
export function validateRecipientQr(raw: string, selfId: string): { ok: true; recipient: RecipientIdentity } | { ok: false; error: string } {
  const r = parseRecipientQR(raw, SERVER_PUBLIC_KEY);
  if (!r.ok) return r;
  if (r.value.id === selfId) return { ok: false, error: 'You cannot pay yourself.' };
  return { ok: true, recipient: r.value };
}

/** Sender: PIN-authorized, atomic payment creation. Throws repo.LocalError / PayError; nothing is changed on failure. */
export async function createPayment(userId: string, userName: string, recipient: RecipientIdentity, amount: number, pin: string) {
  if (!(await crypto.verifyPin(userId, pin))) throw new PayError('Incorrect PIN.');
  const kp = await crypto.loadKeyPair(userId);
  if (!kp) throw new PayError('No signing key on this device. Log in again.');
  const cert = await ownCertificate(userId);
  if (cert.pk !== kp.publicKey) throw new PayError('Certificate does not match this device key. Log in again.');
  if (!isValidAmount(amount)) throw new PayError('Enter a valid amount.');

  const out = await repo.createOutgoingPayment(
    userId,
    { payerName: userName, recipientId: recipient.id, recipientName: recipient.name, amount, reference: recipient.reference, certificate: cert },
    (draft) => {
      const payment = signPayment(draft, kp.secretKey);
      return { payment, qr: encodePaymentQR(payment, cert) };
    }
  );
  return out;
}

export type AcceptResult =
  | { ok: true; payment: Payment; balance: number }
  | { ok: false; error: string; expired?: boolean };

/** Receiver: validate a scanned payment QR and credit automatically. */
export async function acceptIncomingPayment(userId: string, userName: string, raw: string, now = Date.now()): Promise<AcceptResult> {
  const parsed = parsePaymentQR(raw);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const { payment, certificate } = parsed.value;

  if (payment.recipient_id !== userId) return { ok: false, error: 'This payment is addressed to someone else.' };
  if (now > payment.expires_at + CLOCK_SKEW_MS) return { ok: false, error: 'This payment QR has expired. Ask the sender to pay again — their money is refunded automatically.', expired: true };
  if (!verifyCertificate(certificate, SERVER_PUBLIC_KEY, now)) return { ok: false, error: "The sender's certificate is invalid or expired." };
  if (certificate.aid !== payment.payer_id || certificate.nm !== payment.payer_name) return { ok: false, error: "Sender details do not match their certificate." };
  if (!verifyPayment(payment, certificate.pk)) return { ok: false, error: 'Invalid payment signature.' };
  if (!isValidAmount(payment.amount)) return { ok: false, error: 'Invalid payment amount.' };

  const kp = await crypto.loadKeyPair(userId);
  if (!kp) return { ok: false, error: 'No signing key on this device. Log in again.' };
  let own: Certificate;
  try { own = await ownCertificate(userId); } catch (e: any) { return { ok: false, error: e.message }; }

  try {
    const acceptance = signAcceptance(payment, own, kp.secretKey, now);
    const { balance } = await repo.recordIncomingPayment(userId, payment, certificate, acceptance, userName, now);
    return { ok: true, payment, balance };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Could not record the payment.' };
  }
}
