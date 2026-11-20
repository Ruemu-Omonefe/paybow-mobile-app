/**
 * Synchronization (spec "Transaction synchronization"): auto-sync when connectivity returns.
 * Funding records first, then payments, in chunks. Same transaction IDs on every retry. A failed sync never touches the
 * deadline. When nothing is outstanding an empty `complete` sync is still sent (heartbeat used by the refund evidence).
 */
import { api, ApiError, SubmittedTx } from './api';
import * as repo from '../db/repo';
import * as crypto from '../lib/crypto';
import { SERVER_PUBLIC_KEY, SYNC_BATCH_SIZE, CERT_RENEW_BEFORE_MS } from '../config';
import { verifyCertificate } from '../lib/protocol';

export interface SyncOutcome { ok: boolean; submitted: number; resolved: number; balance: number | null; error?: string }
let running: Promise<SyncOutcome> | null = null;

async function renewCertificate(userId: string) {
  const cert = await repo.getCertificate(userId);
  if (cert && cert.exp - Date.now() > CERT_RENEW_BEFORE_MS) return;
  const kp = await crypto.loadKeyPair(userId);
  if (!kp) return;
  try {
    const { certificate } = await api.certificate(kp.publicKey);
    if (certificate.pk === kp.publicKey && verifyCertificate(certificate, SERVER_PUBLIC_KEY)) await repo.saveCertificate(userId, certificate);
  } catch { /* try again next sync */ }
}

async function toSubmitted(owner: string, t: repo.LocalTx): Promise<SubmittedTx | null> {
  if (!t.signature || !t.payer_certificate) return null;
  const deps = t.role === 'PAYER' ? (await repo.getDependencies(owner, t.transaction_id)).map((d) => d.depends_on_id) : undefined;
  return {
    transaction_id: t.transaction_id, payer_id: t.payer_id, payer_name: t.payer_name || '', recipient_id: t.recipient_id, amount: t.amount, currency: t.currency,
    timestamp: t.timestamp, expires_at: t.expires_at, reference: t.reference || '', signature: t.signature,
    payer_certificate: JSON.parse(t.payer_certificate), ...(t.acceptance ? { acceptance: JSON.parse(t.acceptance) } : {}), ...(deps ? { dependencies: deps } : {}),
  };
}

async function run(owner: string, force: boolean): Promise<SyncOutcome> {
  const started = Date.now();
  await repo.expireOverdue(owner);
  if (force) await repo.clearBackoff(owner);
  await renewCertificate(owner);

  const due = await repo.dueItems(owner, Date.now());
  let funding = due.funding.slice(0, SYNC_BATCH_SIZE);
  let payments = due.payments.slice(0, SYNC_BATCH_SIZE);
  const queuedAll = due.funding.length <= SYNC_BATCH_SIZE && due.payments.length <= SYNC_BATCH_SIZE;
  // "complete" = everything that is outstanding is part of this upload
  const complete = queuedAll && due.outstandingTotal === due.funding.length + due.payments.length;

  const subs: { tx: repo.LocalTx; body: SubmittedTx }[] = [];
  for (const p of payments) { const b = await toSubmitted(owner, p); if (b) subs.push({ tx: p, body: b }); }
  const sendIds = [...funding.map((f) => f.transaction_id), ...subs.map((s) => s.tx.transaction_id)];
  await repo.markSyncing(owner, sendIds);

  let resolved = 0;
  try {
    const res = await api.sync({ funding: funding.map((f) => ({ reference: f.transaction_id, amount: f.amount })), transactions: subs.map((s) => s.body), complete });
    const retry: string[] = [];
    for (const r of res.funding_results) {
      if (!r.reference) continue;
      if (r.status === 'ERROR') { retry.push(r.reference); continue; }
      if ((await repo.applyServerState(owner, r.reference, { status: r.status, reason: r.reason })) === 'final') resolved++;
    }
    for (const r of res.results) {
      if (!r.transaction_id) continue;
      if (r.status === 'ERROR') { retry.push(r.transaction_id); continue; }
      const o = await repo.applyServerState(owner, r.transaction_id, { status: r.status, reason: r.reason, refund: r.refund });
      if (o === 'final') resolved++; else if (o === 'pending') retry.push(r.transaction_id);
    }
    // anything we sent but got no answer for goes back to PENDING_SYNC
    const answered = new Set([...res.funding_results.map((r) => r.reference), ...res.results.map((r) => r.transaction_id)]);
    for (const id of sendIds) if (!answered.has(id)) retry.push(id);
    await repo.markRetry(owner, retry, 'Waiting for the server');
    await repo.logSync(owner, started, sendIds.length, resolved, true, Date.now() - started);
    return { ok: true, submitted: sendIds.length, resolved, balance: res.balance };
  } catch (e: any) {
    await repo.markRetry(owner, sendIds, e?.message || 'Sync failed');
    await repo.logSync(owner, started, sendIds.length, 0, false, Date.now() - started);
    return { ok: false, submitted: sendIds.length, resolved: 0, balance: null, error: e instanceof ApiError ? e.message : 'Sync failed' };
  }
}

export function syncNow(owner: string, force = false): Promise<SyncOutcome> {
  if (!running) running = run(owner, force).finally(() => { running = null; });
  return running;
}
