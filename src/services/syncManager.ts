/**
 * Synchronization manager – implements section 3.7.2 on the device side.
 *
 *  for each locally PENDING transaction (queue order):
 *    PENDING -> SYNCING -> submit {transaction_id + signed payload} to POST /api/sync
 *    backend replies ACCEPTED | REJECTED | CONFLICT (+reason)  -> local status mirrors it (backend is authoritative)
 *    temporary failure (offline / timeout / 5xx)               -> back to PENDING, same transaction_id, exponential back-off
 */
import { SYNC_BATCH_SIZE } from '../config';
import * as repo from '../db/repo';
import { api, ApiError } from './api';
import { TxStatus } from '../lib/protocol';

export interface SyncReport {
  skipped?: boolean;
  submitted: number;
  resolved: number;
  failed: number;
  error?: string;
}

let running = false;
const toPayload = (t: repo.LocalTx) => ({
  transaction_id: t.transaction_id, payer_id: t.payer_id, recipient_id: t.recipient_id, amount: t.amount, currency: t.currency,
  timestamp: t.timestamp, nonce: t.nonce, expires_at: t.expires_at, signature: t.signature,
});

export async function syncNow(owner: string, opts: { ignoreBackoff?: boolean } = {}): Promise<SyncReport> {
  if (running) return { skipped: true, submitted: 0, resolved: 0, failed: 0 };
  running = true;
  const report: SyncReport = { submitted: 0, resolved: 0, failed: 0 };
  try {
    if (opts.ignoreBackoff) await repo.clearBackoff(owner);
    const due = await repo.dueTransactions(owner, Date.now());

    for (let i = 0; i < due.length; i += SYNC_BATCH_SIZE) {
      const chunk = due.slice(i, i + SYNC_BATCH_SIZE);
      const ids = chunk.map((t) => t.transaction_id);
      const started = Date.now();
      await repo.markSyncing(owner, ids); // PENDING -> SYNCING
      report.submitted += ids.length;
      try {
        const res = await api.sync(chunk.map(toPayload));
        const byId = new Map(res.results.map((r) => [r.transaction_id, r]));
        let resolved = 0;
        const retry: string[] = [];
        for (const id of ids) {
          const r = byId.get(id);
          if (r && (r.status === 'ACCEPTED' || r.status === 'REJECTED' || r.status === 'CONFLICT')) {
            await repo.applyServerResult(owner, id, r.status as TxStatus, r.reason);
            resolved++;
          } else retry.push(id); // ERROR / missing -> retry later with the SAME id
        }
        if (retry.length) {
          await repo.markRetry(owner, retry, 'Temporary server error');
          report.failed += retry.length;
        }
        report.resolved += resolved;
        await repo.cacheBalance(owner, res.balance);
        await repo.logSync(owner, started, ids.length, resolved, true, Date.now() - started);
      } catch (e: any) {
        const err = e as ApiError;
        // 401: keep items queued untouched; any temporary failure: re-queue and stop this run
        await repo.markRetry(owner, ids, err.message || 'Sync failed');
        await repo.logSync(owner, started, ids.length, 0, false, Date.now() - started);
        report.failed += ids.length;
        report.error = err.message;
        break;
      }
    }
    await pullServer(owner).catch(() => undefined);
    return report;
  } finally {
    running = false;
  }
}

/** Reconcile with the server: transactions the other party already synced, plus the authoritative balance. */
export async function pullServer(owner: string) {
  const [w, t] = await Promise.all([api.wallet(), api.transactions(50)]);
  await repo.cacheBalance(owner, w.balance);
  for (const r of t.transactions) {
    if (r.payer_name) await repo.upsertUser({ id: r.payer_id, name: r.payer_name });
    if (r.recipient_name) await repo.upsertUser({ id: r.recipient_id, name: r.recipient_name });
  }
  await repo.reconcileFromServer(owner, t.transactions);
}
