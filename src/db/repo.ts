/** Repository over SQLite: local transaction log, sync queue, caches. */
import { getDb } from './db';
import { SignedTransaction, TxStatus } from '../lib/protocol';

export interface LocalTx extends SignedTransaction {
  owner_id: string;
  role: 'PAYER' | 'RECIPIENT';
  payer_name: string | null;
  recipient_name: string | null;
  status: TxStatus;
  attempts: number;
  last_error: string | null;
  created_at: number;
  resolved_at: number | null;
}

/* ---------------- users cache ---------------- */
export interface CachedUser {
  user_id: string;
  display_name: string;
  account_reference: string | null;
  public_key: string | null;
}

export async function upsertUser(u: { id: string; name: string; account_reference?: string | null; public_key?: string | null }) {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO users (user_id, display_name, account_reference, public_key, updated_at) VALUES (?,?,?,?,?)
     ON CONFLICT(user_id) DO UPDATE SET display_name=excluded.display_name,
       account_reference=COALESCE(excluded.account_reference, users.account_reference),
       public_key=COALESCE(excluded.public_key, users.public_key), updated_at=excluded.updated_at`,
    [u.id, u.name, u.account_reference ?? null, u.public_key ?? null, Date.now()]
  );
}
export async function getCachedUser(id: string): Promise<CachedUser | null> {
  const db = await getDb();
  return db.getFirstAsync<CachedUser>('SELECT * FROM users WHERE user_id = ?', [id]);
}

/* ---------------- wallet cache (display only – never authoritative offline) ---------------- */
export async function cacheBalance(userId: string, kobo: number) {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO wallet_cache (wallet_id, user_id, cached_balance, last_updated) VALUES (?,?,?,?)
     ON CONFLICT(wallet_id) DO UPDATE SET cached_balance=excluded.cached_balance, last_updated=excluded.last_updated`,
    [`w_${userId}`, userId, kobo, Date.now()]
  );
}
export async function getCachedBalance(userId: string): Promise<{ balance: number; updatedAt: number } | null> {
  const db = await getDb();
  const r = await db.getFirstAsync<{ cached_balance: number; last_updated: number }>(
    'SELECT cached_balance, last_updated FROM wallet_cache WHERE user_id = ?',
    [userId]
  );
  return r ? { balance: r.cached_balance, updatedAt: r.last_updated } : null;
}

/* ---------------- transactions ---------------- */

/** Step 9/10 of the workflow: persist BEFORE any network call; status = PENDING and queued for sync. */
export async function insertLocalTransaction(
  owner: string,
  role: 'PAYER' | 'RECIPIENT',
  tx: SignedTransaction,
  names: { payer: string | null; recipient: string | null }
): Promise<'inserted' | 'exists'> {
  const db = await getDb();
  const existing = await db.getFirstAsync('SELECT 1 AS x FROM transactions WHERE owner_id=? AND transaction_id=?', [owner, tx.transaction_id]);
  if (existing) return 'exists';
  const now = Date.now();
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `INSERT INTO transactions (owner_id, transaction_id, role, payer_id, payer_name, recipient_id, recipient_name, amount, currency,
        timestamp, nonce, expires_at, signature, status, attempts, last_error, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?, 'PENDING', 0, NULL, ?)`,
      [owner, tx.transaction_id, role, tx.payer_id, names.payer, tx.recipient_id, names.recipient, tx.amount, tx.currency,
        tx.timestamp, tx.nonce, tx.expires_at, tx.signature, now]
    );
    await db.runAsync('INSERT INTO sync_queue (owner_id, transaction_id, queued_at, retry_after, attempts) VALUES (?,?,?,0,0)', [owner, tx.transaction_id, now]);
  });
  return 'inserted';
}

export async function listTransactions(owner: string, limit = 200): Promise<LocalTx[]> {
  const db = await getDb();
  return db.getAllAsync<LocalTx>('SELECT * FROM transactions WHERE owner_id = ? ORDER BY timestamp DESC LIMIT ?', [owner, limit]);
}
export async function getTransaction(owner: string, id: string): Promise<LocalTx | null> {
  const db = await getDb();
  return db.getFirstAsync<LocalTx>('SELECT * FROM transactions WHERE owner_id=? AND transaction_id=?', [owner, id]);
}

/** Pending items whose retry window has elapsed (oldest first). */
export async function dueTransactions(owner: string, now: number, limit = 100): Promise<LocalTx[]> {
  const db = await getDb();
  return db.getAllAsync<LocalTx>(
    `SELECT t.* FROM sync_queue q JOIN transactions t ON t.owner_id=q.owner_id AND t.transaction_id=q.transaction_id
     WHERE q.owner_id=? AND q.retry_after<=? AND t.status IN ('PENDING') ORDER BY q.queued_at ASC LIMIT ?`,
    [owner, now, limit]
  );
}

export async function markSyncing(owner: string, ids: string[]) {
  if (!ids.length) return;
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    for (const id of ids) await db.runAsync("UPDATE transactions SET status='SYNCING' WHERE owner_id=? AND transaction_id=? AND status='PENDING'", [owner, id]);
  });
}

/** Backend result is final: update the local status, store the reason, leave the queue. */
export async function applyServerResult(owner: string, id: string, status: TxStatus, reason: string | null) {
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    await db.runAsync('UPDATE transactions SET status=?, last_error=?, resolved_at=? WHERE owner_id=? AND transaction_id=?', [status, reason, Date.now(), owner, id]);
    await db.runAsync('DELETE FROM sync_queue WHERE owner_id=? AND transaction_id=?', [owner, id]);
  });
}

/** Temporary failure: back to PENDING, same transaction_id, exponential back-off. */
export async function markRetry(owner: string, ids: string[], error: string) {
  if (!ids.length) return;
  const db = await getDb();
  const now = Date.now();
  await db.withTransactionAsync(async () => {
    for (const id of ids) {
      const q = await db.getFirstAsync<{ attempts: number }>('SELECT attempts FROM sync_queue WHERE owner_id=? AND transaction_id=?', [owner, id]);
      const attempts = (q?.attempts ?? 0) + 1;
      const delay = Math.min(5 * 60_000, 5_000 * 2 ** Math.min(attempts, 7));
      await db.runAsync("UPDATE transactions SET status='PENDING', attempts=?, last_error=? WHERE owner_id=? AND transaction_id=? AND status IN ('SYNCING','PENDING')", [attempts, error, owner, id]);
      await db.runAsync('UPDATE sync_queue SET attempts=?, retry_after=? WHERE owner_id=? AND transaction_id=?', [attempts, now + delay, owner, id]);
    }
  });
}

/** App was killed mid-sync: anything left SYNCING goes back to PENDING (nothing is lost). */
export async function recoverInterrupted(owner: string) {
  const db = await getDb();
  await db.runAsync("UPDATE transactions SET status='PENDING' WHERE owner_id=? AND status='SYNCING'", [owner]);
  await db.runAsync('UPDATE sync_queue SET retry_after=0 WHERE owner_id=?', [owner]);
}

/** Make a manual "retry now" possible for items in back-off. */
export async function clearBackoff(owner: string) {
  const db = await getDb();
  await db.runAsync('UPDATE sync_queue SET retry_after=0 WHERE owner_id=?', [owner]);
}

export async function pendingStats(owner: string): Promise<{ count: number; outgoing: number }> {
  const db = await getDb();
  const r = await db.getFirstAsync<{ c: number; o: number | null }>(
    `SELECT COUNT(*) AS c, SUM(CASE WHEN role='PAYER' THEN amount ELSE 0 END) AS o
     FROM transactions WHERE owner_id=? AND status IN ('PENDING','SYNCING')`,
    [owner]
  );
  return { count: r?.c ?? 0, outgoing: r?.o ?? 0 };
}

/** Merge transactions fetched from the server (e.g. ones the other party already synced). */
export async function reconcileFromServer(
  owner: string,
  rows: Array<SignedTransaction & { payer_name: string | null; recipient_name: string | null; status: TxStatus; reason: string | null; processed_at: number }>
) {
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    for (const r of rows) {
      const local = await db.getFirstAsync<{ status: string }>('SELECT status FROM transactions WHERE owner_id=? AND transaction_id=?', [owner, r.transaction_id]);
      if (!local) {
        await db.runAsync(
          `INSERT INTO transactions (owner_id, transaction_id, role, payer_id, payer_name, recipient_id, recipient_name, amount, currency,
            timestamp, nonce, expires_at, signature, status, attempts, last_error, created_at, resolved_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,?,?,?)`,
          [owner, r.transaction_id, r.payer_id === owner ? 'PAYER' : 'RECIPIENT', r.payer_id, r.payer_name, r.recipient_id, r.recipient_name,
            r.amount, r.currency, r.timestamp, r.nonce, r.expires_at, r.signature, r.status, r.reason, r.timestamp, r.processed_at]
        );
      } else if (local.status === 'PENDING' || local.status === 'SYNCING') {
        await db.runAsync('UPDATE transactions SET status=?, last_error=?, resolved_at=? WHERE owner_id=? AND transaction_id=?', [r.status, r.reason, r.processed_at, owner, r.transaction_id]);
        await db.runAsync('DELETE FROM sync_queue WHERE owner_id=? AND transaction_id=?', [owner, r.transaction_id]);
      }
    }
  });
}

/* ---------------- evaluation metrics (section 3.9.1) ---------------- */
export async function logSync(owner: string, startedAt: number, submitted: number, resolved: number, ok: boolean, latencyMs: number) {
  const db = await getDb();
  await db.runAsync('INSERT INTO sync_log (owner_id, started_at, submitted, resolved, ok, latency_ms) VALUES (?,?,?,?,?,?)', [owner, startedAt, submitted, resolved, ok ? 1 : 0, latencyMs]);
}

export interface SyncMetrics {
  attempts: number;
  successRate: number | null; // % of submitted items that received a final backend outcome
  avgLatencyMs: number | null;
  submitted: number;
  resolved: number;
}
export async function syncMetrics(owner: string): Promise<SyncMetrics> {
  const db = await getDb();
  const r = await db.getFirstAsync<{ n: number; s: number | null; r: number | null; l: number | null }>(
    'SELECT COUNT(*) AS n, SUM(submitted) AS s, SUM(resolved) AS r, AVG(CASE WHEN ok=1 THEN latency_ms END) AS l FROM sync_log WHERE owner_id=?',
    [owner]
  );
  const s = r?.s ?? 0;
  return { attempts: r?.n ?? 0, submitted: s, resolved: r?.r ?? 0, successRate: s ? Math.round(((r?.r ?? 0) / s) * 100) : null, avgLatencyMs: r?.l != null ? Math.round(r.l) : null };
}
