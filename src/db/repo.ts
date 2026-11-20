/**
 * Repository over SQLite: local wallet, ledger, transactions, dependencies, funding, sync queue, deadline.
 * Every operation that changes money (outgoing payment, incoming payment, funding, refund) runs in ONE atomic
 * SQLite transaction together with its ledger entry, so a failure leaves nothing half-written.
 */
import type * as SQLite from 'expo-sqlite';
import { getDb, getMeta, setMeta } from './db';
import { Acceptance, Certificate, CLOCK_SKEW_MS, CURRENCY, FundingConfirmation, isValidAmount, newTransactionId, Payment, PAYMENT_QR_TTL_MS, TxStatus } from '../lib/protocol';
import { dayKey } from '../lib/money';
import { DAILY_OFFLINE_LIMIT_KOBO, SYNC_DEADLINE_MS } from '../config';

type Db = SQLite.SQLiteDatabase;

export class LocalError extends Error {
  constructor(public code: 'NO_WALLET' | 'RESTRICTED' | 'INVALID_AMOUNT' | 'INSUFFICIENT' | 'DAILY_LIMIT' | 'DUPLICATE' | 'FAILED', message: string) {
    super(message);
  }
}

export interface LocalTx {
  owner_id: string;
  transaction_id: string;
  kind: 'PAYMENT' | 'FUNDING';
  role: 'PAYER' | 'RECIPIENT';
  payer_id: string;
  payer_name: string | null;
  recipient_id: string;
  recipient_name: string | null;
  amount: number;
  currency: string;
  timestamp: number;
  expires_at: number;
  reference: string | null;
  signature: string | null;
  payer_certificate: string | null;
  acceptance: string | null;
  status: TxStatus;
  attempts: number;
  last_error: string | null;
  delivered: number;
  created_at: number;
  resolved_at: number | null;
  refund_reference: string | null;
}

interface WalletRow {
  wallet_id: string;
  user_id: string;
  balance: number;
  daily_offline_total: number;
  daily_day: string | null;
  sync_deadline: number | null;
  last_updated: number;
}

const OUTSTANDING = "('PENDING_SYNC','SYNCING','EXPIRED')";
const TERMINAL: TxStatus[] = ['CONFIRMED', 'REJECTED', 'CONFLICT', 'REFUNDED'];

/* ================================================================ users / certificate / wallet */
export async function upsertUser(u: { id: string; name: string; wallet_id?: string | null; email?: string | null; public_key?: string | null }) {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO users (user_id, display_name, account_reference, email, public_key, updated_at) VALUES (?,?,?,?,?,?)
     ON CONFLICT(user_id) DO UPDATE SET display_name=excluded.display_name,
       account_reference=COALESCE(excluded.account_reference, users.account_reference),
       email=COALESCE(excluded.email, users.email),
       public_key=COALESCE(excluded.public_key, users.public_key), updated_at=excluded.updated_at`,
    [u.id, u.name, u.wallet_id ?? null, u.email ?? null, u.public_key ?? null, Date.now()]
  );
}

export async function saveCertificate(owner: string, cert: Certificate) {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO certificates (owner_id, certificate, issued_at, expires_at) VALUES (?,?,?,?)
     ON CONFLICT(owner_id) DO UPDATE SET certificate=excluded.certificate, issued_at=excluded.issued_at, expires_at=excluded.expires_at`,
    [owner, JSON.stringify(cert), cert.iat, cert.exp]
  );
}
export async function getCertificate(owner: string): Promise<Certificate | null> {
  const db = await getDb();
  const r = await db.getFirstAsync<{ certificate: string }>('SELECT certificate FROM certificates WHERE owner_id = ?', [owner]);
  return r ? (JSON.parse(r.certificate) as Certificate) : null;
}

/** Step 11-12 of registration/login: the LOCAL wallet is created here with ₦0, independently of the backend mirror. */
export async function ensureWallet(owner: string, walletId: string) {
  const db = await getDb();
  await db.runAsync('INSERT OR IGNORE INTO wallet (wallet_id, user_id, balance, daily_offline_total, daily_day, sync_deadline, last_updated) VALUES (?,?,0,0,NULL,NULL,?)', [walletId, owner, Date.now()]);
}

async function walletRow(db: Db, owner: string): Promise<WalletRow | null> {
  return db.getFirstAsync<WalletRow>('SELECT * FROM wallet WHERE user_id = ?', [owner]);
}

export interface WalletInfo { wallet_id: string; balance: number; dailyUsed: number; dailyRemaining: number; last_updated: number }
export async function getWallet(owner: string, now = Date.now()): Promise<WalletInfo | null> {
  const db = await getDb();
  const w = await walletRow(db, owner);
  if (!w) return null;
  const used = w.daily_day === dayKey(now) ? w.daily_offline_total : 0;
  return { wallet_id: w.wallet_id, balance: w.balance, dailyUsed: used, dailyRemaining: Math.max(0, DAILY_OFFLINE_LIMIT_KOBO - used), last_updated: w.last_updated };
}

/* ================================================================ synchronization deadline */
export interface DeadlineInfo {
  deadline: number | null;
  startedAt: number | null;
  outstanding: number; // outstanding offline PAYMENTS (pending / syncing / expired)
  restricted: boolean; // deadline passed AND outstanding transactions still exist
  stage: 0 | 1 | 2; // reminder stage: 1 after 1/3 of the window (24 h of 72 h), 2 after 2/3 (48 h)
}

async function deadlineInfoIn(db: Db, owner: string, now: number, w?: WalletRow | null): Promise<DeadlineInfo> {
  const row = w === undefined ? await walletRow(db, owner) : w;
  const c = await db.getFirstAsync<{ c: number }>(`SELECT COUNT(*) AS c FROM transactions WHERE owner_id=? AND kind='PAYMENT' AND status IN ${OUTSTANDING}`, [owner]);
  const outstanding = c?.c ?? 0;
  const deadline = row?.sync_deadline ?? null;
  const startedAt = deadline === null ? null : deadline - SYNC_DEADLINE_MS;
  let stage: 0 | 1 | 2 = 0;
  if (deadline !== null && outstanding > 0) {
    const elapsed = now - (startedAt as number);
    stage = elapsed >= (SYNC_DEADLINE_MS * 2) / 3 ? 2 : elapsed >= SYNC_DEADLINE_MS / 3 ? 1 : 0;
  }
  return { deadline, startedAt, outstanding, restricted: deadline !== null && now > deadline && outstanding > 0, stage };
}
export async function getDeadlineInfo(owner: string, now = Date.now()): Promise<DeadlineInfo> {
  return deadlineInfoIn(await getDb(), owner, now);
}

/** Timer starts with the FIRST outstanding offline transaction and keeps running (never restarted by a sync attempt). */
async function ensureDeadline(db: Db, owner: string, now: number) {
  await db.runAsync('UPDATE wallet SET sync_deadline = ? WHERE user_id = ? AND sync_deadline IS NULL', [now + SYNC_DEADLINE_MS, owner]);
}
/** Cleared only when ALL outstanding transactions are reconciled. */
async function clearDeadlineIfSettled(db: Db, owner: string) {
  const c = await db.getFirstAsync<{ c: number }>(`SELECT COUNT(*) AS c FROM transactions WHERE owner_id=? AND kind='PAYMENT' AND status IN ${OUTSTANDING}`, [owner]);
  if ((c?.c ?? 0) === 0) await db.runAsync('UPDATE wallet SET sync_deadline = NULL WHERE user_id = ?', [owner]);
}

/* ================================================================ ledger helpers (always inside a DB transaction) */
async function postLedger(
  db: Db, owner: string, w: WalletRow,
  e: { key: string; txId: string; type: 'CREDIT' | 'DEBIT' | 'REFUND'; source: 'FUNDING' | 'TRANSFER' | 'REFUND'; amount: number; status: string; now: number }
): Promise<number> {
  const balance = e.type === 'DEBIT' ? w.balance - e.amount : w.balance + e.amount;
  if (balance < 0) throw new LocalError('INSUFFICIENT', 'Insufficient wallet balance');
  await db.runAsync(
    'INSERT INTO ledger (owner_id, wallet_id, entry_key, transaction_id, type, source, amount, balance_after, status, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
    [owner, w.wallet_id, `${owner}:${e.key}`, e.txId, e.type, e.source, e.amount, balance, e.status, e.now]
  );
  w.balance = balance;
  return balance;
}

/* ================================================================ outgoing payment (sender, spec C 13-19) */
export interface OutgoingInput { payerName: string; recipientId: string; recipientName: string; amount: number; reference: string; certificate: Certificate; now?: number }

/**
 * ONE atomic database transaction: re-check restriction / balance / daily allowance, generate the transaction ID and
 * payment information, debit the wallet, add the DEBIT ledger entry, update the daily offline total, record the
 * transaction as PENDING_SYNC, set the deadline (first outstanding transaction), save dependencies and queue it.
 * `build` signs the payment and produces the QR; if it (or anything else) throws, EVERYTHING is rolled back.
 */
export async function createOutgoingPayment(
  owner: string,
  input: OutgoingInput,
  build: (draft: Omit<Payment, 'signature'>) => { payment: Payment; qr: string }
): Promise<{ payment: Payment; qr: string; balance: number; dependencies: string[] }> {
  const db = await getDb();
  const now = input.now ?? Date.now();
  let out!: { payment: Payment; qr: string; balance: number; dependencies: string[] };

  await db.withTransactionAsync(async () => {
    const w = await walletRow(db, owner);
    if (!w) throw new LocalError('NO_WALLET', 'Wallet not found');
    if ((await deadlineInfoIn(db, owner, now, w)).restricted)
      throw new LocalError('RESTRICTED', 'Offline payments are paused until your pending transactions are synchronized.');
    if (!isValidAmount(input.amount)) throw new LocalError('INVALID_AMOUNT', 'Enter a valid amount.');
    if (input.amount > w.balance) throw new LocalError('INSUFFICIENT', 'Insufficient wallet balance.');
    const today = dayKey(now);
    const spentToday = w.daily_day === today ? w.daily_offline_total : 0;
    if (spentToday + input.amount > DAILY_OFFLINE_LIMIT_KOBO) throw new LocalError('DAILY_LIMIT', 'This payment exceeds your remaining daily offline spending allowance.');

    // unique transaction ID + payment information (sender ID/name, receiver ID, amount, currency, timestamp, expiry)
    const draft: Omit<Payment, 'signature'> = {
      transaction_id: newTransactionId(), payer_id: owner, payer_name: input.payerName, recipient_id: input.recipientId, amount: input.amount,
      currency: CURRENCY, timestamp: now, expires_at: now + PAYMENT_QR_TTL_MS, reference: input.reference,
    };

    // dependencies: spend confirmed money first, then (FIFO) unconfirmed credits – record the amount drawn from each
    const pending = await db.getAllAsync<{ ref: string; amount: number; allocated: number }>(
      `SELECT l.transaction_id AS ref, l.amount AS amount,
              COALESCE((SELECT SUM(d.amount) FROM transaction_dependencies d WHERE d.owner_id=l.owner_id AND d.depends_on_id=l.transaction_id),0) AS allocated
       FROM ledger l WHERE l.owner_id=? AND l.type='CREDIT' AND l.status='PENDING_SYNC' ORDER BY l.created_at ASC, l.entry_id ASC`,
      [owner]
    );
    const unallocatedPending = pending.reduce((s, p) => s + (p.amount - p.allocated), 0);
    let need = Math.max(0, input.amount - Math.max(0, w.balance - unallocatedPending));
    const deps: { ref: string; amount: number }[] = [];
    for (const p of pending) {
      if (need <= 0) break;
      const remaining = p.amount - p.allocated;
      if (remaining <= 0) continue;
      const take = Math.min(remaining, need);
      deps.push({ ref: p.ref, amount: take });
      need -= take;
    }

    const balance = await postLedger(db, owner, w, { key: `TX:${draft.transaction_id}:DEBIT`, txId: draft.transaction_id, type: 'DEBIT', source: 'TRANSFER', amount: input.amount, status: 'PENDING_SYNC', now });
    await db.runAsync('UPDATE wallet SET balance=?, daily_offline_total=?, daily_day=?, last_updated=? WHERE user_id=?', [balance, spentToday + input.amount, today, now, owner]);
    await db.runAsync(
      `INSERT INTO transactions (owner_id, transaction_id, kind, role, payer_id, payer_name, recipient_id, recipient_name, amount, currency, timestamp, expires_at,
         reference, signature, payer_certificate, acceptance, status, attempts, last_error, delivered, created_at)
       VALUES (?,?, 'PAYMENT','PAYER',?,?,?,?,?,?,?,?,?, '', ?, NULL, 'PENDING_SYNC', 0, NULL, 0, ?)`,
      [owner, draft.transaction_id, owner, input.payerName, input.recipientId, input.recipientName, input.amount, CURRENCY, now, draft.expires_at, input.reference, JSON.stringify(input.certificate), now]
    );
    for (const d of deps) await db.runAsync('INSERT INTO transaction_dependencies (owner_id, transaction_id, depends_on_id, amount) VALUES (?,?,?,?)', [owner, draft.transaction_id, d.ref, d.amount]);
    await db.runAsync('INSERT INTO sync_queue (owner_id, transaction_id, queued_at, retry_after, attempts) VALUES (?,?,?,0,0)', [owner, draft.transaction_id, now]);
    await ensureDeadline(db, owner, now);

    // sign + generate the payment QR LAST: if this fails, the whole transaction (debit included) is rolled back
    const built = build(draft);
    await db.runAsync('UPDATE transactions SET signature=?, payer_certificate=? WHERE owner_id=? AND transaction_id=?', [built.payment.signature, JSON.stringify(input.certificate), owner, draft.transaction_id]);
    out = { payment: built.payment, qr: built.qr, balance, dependencies: deps.map((d) => d.ref) };
  });
  return out;
}

/** The sender confirmed that the receiver scanned the payment QR (UX only – the backend stays authoritative). */
export async function markDelivered(owner: string, id: string) {
  const db = await getDb();
  await db.runAsync("UPDATE transactions SET delivered=1 WHERE owner_id=? AND transaction_id=? AND status IN ('PENDING_SYNC','EXPIRED')", [owner, id]);
  await db.runAsync("UPDATE transactions SET status='PENDING_SYNC' WHERE owner_id=? AND transaction_id=? AND status='EXPIRED'", [owner, id]);
}

/* ================================================================ incoming payment (receiver, spec D 28-31) */
export async function recordIncomingPayment(
  owner: string, payment: Payment, payerCertificate: Certificate, acceptance: Acceptance, receiverName: string, now = Date.now()
): Promise<{ balance: number }> {
  const db = await getDb();
  let balance = 0;
  await db.withTransactionAsync(async () => {
    const w = await walletRow(db, owner);
    if (!w) throw new LocalError('NO_WALLET', 'Wallet not found');
    if ((await deadlineInfoIn(db, owner, now, w)).restricted)
      throw new LocalError('RESTRICTED', 'Offline payments are paused until your pending transactions are synchronized.');
    // check AGAIN inside the atomic transaction that the transaction ID is new
    const exists = await db.getFirstAsync('SELECT 1 AS x FROM transactions WHERE owner_id=? AND transaction_id=?', [owner, payment.transaction_id]);
    if (exists) throw new LocalError('DUPLICATE', 'This payment was already recorded on this device.');

    await db.runAsync(
      `INSERT INTO transactions (owner_id, transaction_id, kind, role, payer_id, payer_name, recipient_id, recipient_name, amount, currency, timestamp, expires_at,
         reference, signature, payer_certificate, acceptance, status, attempts, last_error, delivered, created_at)
       VALUES (?,?, 'PAYMENT','RECIPIENT',?,?,?,?,?,?,?,?,?,?,?,?, 'PENDING_SYNC', 0, NULL, 1, ?)`,
      [owner, payment.transaction_id, payment.payer_id, payment.payer_name, owner, receiverName, payment.amount, payment.currency, payment.timestamp, payment.expires_at,
        payment.reference, payment.signature, JSON.stringify(payerCertificate), JSON.stringify(acceptance), now]
    );
    balance = await postLedger(db, owner, w, { key: `TX:${payment.transaction_id}:CREDIT`, txId: payment.transaction_id, type: 'CREDIT', source: 'TRANSFER', amount: payment.amount, status: 'PENDING_SYNC', now });
    await db.runAsync('UPDATE wallet SET balance=?, last_updated=? WHERE user_id=?', [balance, now, owner]);
    await db.runAsync('INSERT INTO sync_queue (owner_id, transaction_id, queued_at, retry_after, attempts) VALUES (?,?,?,0,0)', [owner, payment.transaction_id, now]);
    await ensureDeadline(db, owner, now);
  });
  return { balance };
}

/* ================================================================ wallet funding (spec "Wallet funding" 8-12) */
export async function recordFunding(owner: string, conf: FundingConfirmation, ownerName: string, now = Date.now()): Promise<{ balance: number }> {
  const db = await getDb();
  let balance = 0;
  await db.withTransactionAsync(async () => {
    const w = await walletRow(db, owner);
    if (!w) throw new LocalError('NO_WALLET', 'Wallet not found');
    const dup = await db.getFirstAsync('SELECT 1 AS x FROM funding_records WHERE owner_id=? AND reference=?', [owner, conf.reference]);
    if (dup) throw new LocalError('DUPLICATE', 'This funding reference has already been credited.');

    await db.runAsync('INSERT INTO funding_records (owner_id, reference, amount, currency, status, verified_at, confirmation_signature, created_at) VALUES (?,?,?,?,?,?,?,?)',
      [owner, conf.reference, conf.amount, conf.currency, 'PENDING_SYNC', conf.verified_at, conf.signature, now]);
    balance = await postLedger(db, owner, w, { key: `FUND:${conf.reference}`, txId: conf.reference, type: 'CREDIT', source: 'FUNDING', amount: conf.amount, status: 'PENDING_SYNC', now });
    await db.runAsync('UPDATE wallet SET balance=?, last_updated=? WHERE user_id=?', [balance, now, owner]);
    await db.runAsync(
      `INSERT INTO transactions (owner_id, transaction_id, kind, role, payer_id, payer_name, recipient_id, recipient_name, amount, currency, timestamp, expires_at,
         reference, signature, payer_certificate, acceptance, status, attempts, last_error, delivered, created_at)
       VALUES (?,?, 'FUNDING','RECIPIENT','FUNDING','Wallet funding',?,?,?,?,?,0,?,?,NULL,NULL,'PENDING_SYNC',0,NULL,1,?)`,
      [owner, conf.reference, owner, ownerName, conf.amount, conf.currency, now, conf.reference, conf.signature, now]
    );
    await db.runAsync('INSERT INTO sync_queue (owner_id, transaction_id, queued_at, retry_after, attempts) VALUES (?,?,?,0,0)', [owner, conf.reference, now]);
  });
  return { balance };
}

/* ================================================================ reading */
export async function listTransactions(owner: string, limit = 200): Promise<LocalTx[]> {
  const db = await getDb();
  return db.getAllAsync<LocalTx>('SELECT * FROM transactions WHERE owner_id = ? ORDER BY timestamp DESC LIMIT ?', [owner, limit]);
}
export async function getTransaction(owner: string, id: string): Promise<LocalTx | null> {
  const db = await getDb();
  return db.getFirstAsync<LocalTx>('SELECT * FROM transactions WHERE owner_id=? AND transaction_id=?', [owner, id]);
}
export async function getDependencies(owner: string, id: string): Promise<{ depends_on_id: string; amount: number }[]> {
  const db = await getDb();
  return db.getAllAsync('SELECT depends_on_id, amount FROM transaction_dependencies WHERE owner_id=? AND transaction_id=?', [owner, id]);
}
export async function listLedger(owner: string, limit = 100) {
  const db = await getDb();
  return db.getAllAsync<{ entry_id: number; transaction_id: string; type: string; source: string; amount: number; balance_after: number; status: string; created_at: number }>(
    'SELECT entry_id, transaction_id, type, source, amount, balance_after, status, created_at FROM ledger WHERE owner_id=? ORDER BY entry_id DESC LIMIT ?', [owner, limit]);
}

/** Ledger integrity check: the stored balance must equal the sum of all ledger entries. */
export async function verifyLedger(owner: string): Promise<{ ok: boolean; balance: number; ledgerSum: number }> {
  const db = await getDb();
  const w = await walletRow(db, owner);
  const r = await db.getFirstAsync<{ s: number | null }>("SELECT SUM(CASE WHEN type='DEBIT' THEN -amount ELSE amount END) AS s FROM ledger WHERE owner_id=?", [owner]);
  const ledgerSum = r?.s ?? 0;
  return { ok: (w?.balance ?? 0) === ledgerSum, balance: w?.balance ?? 0, ledgerSum };
}

export async function pendingStats(owner: string): Promise<{ count: number; outgoing: number }> {
  const db = await getDb();
  const r = await db.getFirstAsync<{ c: number; o: number | null }>(
    `SELECT COUNT(*) AS c, SUM(CASE WHEN kind='PAYMENT' AND role='PAYER' THEN amount ELSE 0 END) AS o FROM transactions WHERE owner_id=? AND status IN ${OUTSTANDING}`, [owner]);
  return { count: r?.c ?? 0, outgoing: r?.o ?? 0 };
}

/* ================================================================ synchronization state */
/** Outgoing payments whose QR has expired without the sender confirming delivery are marked EXPIRED (still pending, still synced). */
export async function expireOverdue(owner: string, now = Date.now()) {
  const db = await getDb();
  await db.runAsync("UPDATE transactions SET status='EXPIRED' WHERE owner_id=? AND kind='PAYMENT' AND role='PAYER' AND status='PENDING_SYNC' AND delivered=0 AND expires_at + ? < ?", [owner, CLOCK_SKEW_MS, now]);
}

export async function dueItems(owner: string, now: number): Promise<{ funding: LocalTx[]; payments: LocalTx[]; outstandingTotal: number }> {
  const db = await getDb();
  const rows = await db.getAllAsync<LocalTx>(
    `SELECT t.* FROM sync_queue q JOIN transactions t ON t.owner_id=q.owner_id AND t.transaction_id=q.transaction_id
     WHERE q.owner_id=? AND q.retry_after<=? AND t.status IN ('PENDING_SYNC','EXPIRED') ORDER BY t.timestamp ASC`, [owner, now]);
  const c = await db.getFirstAsync<{ c: number }>(`SELECT COUNT(*) AS c FROM transactions WHERE owner_id=? AND status IN ${OUTSTANDING}`, [owner]);
  return { funding: rows.filter((r) => r.kind === 'FUNDING'), payments: rows.filter((r) => r.kind === 'PAYMENT'), outstandingTotal: c?.c ?? 0 };
}

export async function markSyncing(owner: string, ids: string[]) {
  if (!ids.length) return;
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    for (const id of ids) await db.runAsync("UPDATE transactions SET status='SYNCING' WHERE owner_id=? AND transaction_id=? AND status='PENDING_SYNC'", [owner, id]);
  });
}

/** Temporary failure / still unresolved: back to PENDING_SYNC (EXPIRED stays EXPIRED), SAME transaction ID, exponential back-off. */
export async function markRetry(owner: string, ids: string[], note: string, now = Date.now()) {
  if (!ids.length) return;
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    for (const id of ids) {
      const q = await db.getFirstAsync<{ attempts: number }>('SELECT attempts FROM sync_queue WHERE owner_id=? AND transaction_id=?', [owner, id]);
      const attempts = (q?.attempts ?? 0) + 1;
      const delay = Math.min(5 * 60_000, 5_000 * 2 ** Math.min(attempts, 7));
      await db.runAsync("UPDATE transactions SET status=CASE WHEN status='SYNCING' THEN 'PENDING_SYNC' ELSE status END, attempts=?, last_error=? WHERE owner_id=? AND transaction_id=? AND status IN ('SYNCING','PENDING_SYNC','EXPIRED')", [attempts, note, owner, id]);
      await db.runAsync('UPDATE sync_queue SET attempts=?, retry_after=? WHERE owner_id=? AND transaction_id=?', [attempts, now + delay, owner, id]);
    }
  });
}

/** App was killed mid-sync: anything left SYNCING goes back to PENDING_SYNC (nothing is lost). */
export async function recoverInterrupted(owner: string) {
  const db = await getDb();
  await db.runAsync("UPDATE transactions SET status='PENDING_SYNC' WHERE owner_id=? AND status='SYNCING'", [owner]);
  await db.runAsync('UPDATE sync_queue SET retry_after=0 WHERE owner_id=?', [owner]);
}
export async function clearBackoff(owner: string) {
  const db = await getDb();
  await db.runAsync('UPDATE sync_queue SET retry_after=0 WHERE owner_id=?', [owner]);
}

export interface ServerState {
  status: string; // CONFIRMED | REJECTED | CONFLICT | REFUNDED | UNRESOLVED | DEFERRED
  reason?: string | null;
  refund?: { reference: string; amount: number; refunded_at: number } | null;
}

/**
 * Applies the BACKEND's verdict to a local record. Returns 'final' when the record is now reconciled,
 * 'pending' when the backend has not decided yet (UNRESOLVED / DEFERRED), 'ignored' when nothing applied.
 * Rejected / conflicting records are retained (never deleted) for investigation.
 */
export async function applyServerState(owner: string, id: string, s: ServerState, now = Date.now()): Promise<'final' | 'pending' | 'ignored'> {
  const db = await getDb();
  const tx = await getTransaction(owner, id);
  if (!tx || TERMINAL.includes(tx.status)) return 'ignored';

  if (s.status === 'UNRESOLVED' || s.status === 'DEFERRED') {
    await db.runAsync('UPDATE transactions SET last_error=? WHERE owner_id=? AND transaction_id=?', [s.reason ?? null, owner, id]);
    return 'pending';
  }

  if (s.status === 'REFUNDED' && !(tx.role === 'PAYER' && s.refund)) s = { status: 'CONFLICT', reason: s.reason || 'Unexpected refund state' };
  if (s.status !== 'CONFIRMED' && s.status !== 'REJECTED' && s.status !== 'CONFLICT' && s.status !== 'REFUNDED') return 'ignored';

  await db.withTransactionAsync(async () => {
    if (s.status === 'REFUNDED') {
      // Expired payment the receiver never received: ONE refund, identified by its unique refund reference
      const ref = s.refund!.reference;
      const w = (await walletRow(db, owner))!;
      const done = await db.getFirstAsync('SELECT 1 AS x FROM ledger WHERE entry_key=?', [`${owner}:REFUND:${ref}`]);
      if (!done) {
        const balance = await postLedger(db, owner, w, { key: `REFUND:${ref}`, txId: id, type: 'REFUND', source: 'REFUND', amount: tx.amount, status: 'CONFIRMED', now });
        const sameDay = w.daily_day === dayKey(tx.timestamp);
        await db.runAsync('UPDATE wallet SET balance=?, daily_offline_total=?, last_updated=? WHERE user_id=?', [balance, sameDay ? Math.max(0, w.daily_offline_total - tx.amount) : w.daily_offline_total, now, owner]);
      }
      await db.runAsync("UPDATE ledger SET status='REFUNDED' WHERE owner_id=? AND transaction_id=? AND type='DEBIT'", [owner, id]);
      await db.runAsync("UPDATE transactions SET status='REFUNDED', refund_reference=?, last_error=NULL, resolved_at=? WHERE owner_id=? AND transaction_id=?", [ref, now, owner, id]);
    } else {
      const note = s.status === 'CONFIRMED' ? null : s.reason ?? null;
      await db.runAsync('UPDATE transactions SET status=?, last_error=?, resolved_at=? WHERE owner_id=? AND transaction_id=?', [s.status, note, now, owner, id]);
      await db.runAsync('UPDATE ledger SET status=? WHERE owner_id=? AND transaction_id=? AND type IN (\'CREDIT\',\'DEBIT\')', [s.status, owner, id]);
      if (tx.kind === 'FUNDING') await db.runAsync('UPDATE funding_records SET status=? WHERE owner_id=? AND reference=?', [s.status, owner, id]);
    }
    await db.runAsync('DELETE FROM sync_queue WHERE owner_id=? AND transaction_id=?', [owner, id]);
    await clearDeadlineIfSettled(db, owner);
  });
  return 'final';
}

/* ================================================================ evaluation metrics (report §3.9.1) */
export async function logSync(owner: string, startedAt: number, submitted: number, resolved: number, ok: boolean, latencyMs: number) {
  const db = await getDb();
  await db.runAsync('INSERT INTO sync_log (owner_id, started_at, submitted, resolved, ok, latency_ms) VALUES (?,?,?,?,?,?)', [owner, startedAt, submitted, resolved, ok ? 1 : 0, latencyMs]);
}

export interface SyncMetrics { attempts: number; successRate: number | null; avgLatencyMs: number | null; submitted: number; resolved: number }
export async function syncMetrics(owner: string): Promise<SyncMetrics> {
  const db = await getDb();
  const r = await db.getFirstAsync<{ n: number; s: number | null; r: number | null; l: number | null }>(
    'SELECT COUNT(*) AS n, SUM(submitted) AS s, SUM(resolved) AS r, AVG(CASE WHEN ok=1 THEN latency_ms END) AS l FROM sync_log WHERE owner_id=?', [owner]);
  const s = r?.s ?? 0;
  return { attempts: r?.n ?? 0, submitted: s, resolved: r?.r ?? 0, successRate: s ? Math.round(((r?.r ?? 0) / s) * 100) : null, avgLatencyMs: r?.l != null ? Math.round(r.l) : null };
}

export { getMeta, setMeta };
