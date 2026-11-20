/**
 * Local SQLite store (report §3.6.1): users, wallet, ledger, transactions, transaction_dependencies, sync_queue
 * + certificates, funding_records, sync_log, meta. `owner_id` lets several accounts share one device.
 * (v2 schema – new database file, the earlier prototype database is not reused.)
 */
import * as SQLite from 'expo-sqlite';

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

export function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = await SQLite.openDatabaseAsync('paybow_v2.db');
      await db.execAsync(`
        PRAGMA journal_mode = WAL;
        PRAGMA foreign_keys = ON;

        CREATE TABLE IF NOT EXISTS users (
          user_id TEXT PRIMARY KEY NOT NULL,
          display_name TEXT NOT NULL,
          account_reference TEXT,            -- wallet ID issued by the backend
          email TEXT,
          public_key TEXT,
          updated_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS certificates (
          owner_id TEXT PRIMARY KEY NOT NULL,
          certificate TEXT NOT NULL,         -- backend-signed public-key certificate (JSON)
          issued_at INTEGER NOT NULL,
          expires_at INTEGER NOT NULL
        );

        -- the LOCAL wallet: the spendable balance. Created independently of the backend mirror (starts at 0).
        CREATE TABLE IF NOT EXISTS wallet (
          wallet_id TEXT PRIMARY KEY NOT NULL,
          user_id TEXT NOT NULL UNIQUE,
          balance INTEGER NOT NULL DEFAULT 0 CHECK (balance >= 0),   -- kobo
          daily_offline_total INTEGER NOT NULL DEFAULT 0,
          daily_day TEXT,                                            -- local day the total belongs to
          sync_deadline INTEGER,                                     -- epoch ms, NULL = no outstanding offline transactions
          last_updated INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS ledger (
          entry_id INTEGER PRIMARY KEY AUTOINCREMENT,
          owner_id TEXT NOT NULL,
          wallet_id TEXT NOT NULL,
          entry_key TEXT NOT NULL UNIQUE,    -- e.g. "<owner>:FUND:<ref>" – an entry can only ever be written once
          transaction_id TEXT NOT NULL,      -- payment transaction ID / funding reference / refund reference's transaction
          type TEXT NOT NULL CHECK (type IN ('CREDIT','DEBIT','REFUND')),
          source TEXT NOT NULL,              -- FUNDING | TRANSFER | REFUND
          amount INTEGER NOT NULL CHECK (amount > 0),
          balance_after INTEGER NOT NULL,
          status TEXT NOT NULL,              -- PENDING_SYNC | CONFIRMED | REJECTED | CONFLICT | REFUNDED
          created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_ledger_owner ON ledger(owner_id, created_at);

        CREATE TABLE IF NOT EXISTS transactions (
          owner_id TEXT NOT NULL,
          transaction_id TEXT NOT NULL,      -- for FUNDING rows this is the funding reference
          kind TEXT NOT NULL DEFAULT 'PAYMENT',        -- PAYMENT | FUNDING
          role TEXT NOT NULL,                -- PAYER | RECIPIENT (direction for this device owner)
          payer_id TEXT NOT NULL,
          payer_name TEXT,
          recipient_id TEXT NOT NULL,
          recipient_name TEXT,
          amount INTEGER NOT NULL,           -- kobo
          currency TEXT NOT NULL,
          timestamp INTEGER NOT NULL,
          expires_at INTEGER NOT NULL DEFAULT 0,
          reference TEXT,
          signature TEXT,                    -- sender's signature (evidence) / funding confirmation signature
          payer_certificate TEXT,            -- sender's certificate (evidence, JSON)
          acceptance TEXT,                   -- receiver's signed acceptance record (JSON)
          status TEXT NOT NULL,              -- PENDING_SYNC | SYNCING | CONFIRMED | REJECTED | CONFLICT | EXPIRED | REFUNDED
          attempts INTEGER NOT NULL DEFAULT 0,
          last_error TEXT,
          delivered INTEGER NOT NULL DEFAULT 0,        -- sender tapped "receiver scanned it"
          created_at INTEGER NOT NULL,
          resolved_at INTEGER,
          refund_reference TEXT,
          PRIMARY KEY (owner_id, transaction_id)
        );
        CREATE INDEX IF NOT EXISTS idx_tx_owner_time ON transactions(owner_id, timestamp DESC);

        -- which earlier (still unconfirmed) credits support the money a payment spends, and how much is allocated from each
        CREATE TABLE IF NOT EXISTS transaction_dependencies (
          owner_id TEXT NOT NULL,
          transaction_id TEXT NOT NULL,
          depends_on_id TEXT NOT NULL,       -- funding reference or incoming transaction ID
          amount INTEGER NOT NULL,
          PRIMARY KEY (owner_id, transaction_id, depends_on_id)
        );

        CREATE TABLE IF NOT EXISTS funding_records (
          owner_id TEXT NOT NULL,
          reference TEXT NOT NULL,
          amount INTEGER NOT NULL,
          currency TEXT NOT NULL,
          status TEXT NOT NULL,              -- PENDING_SYNC | CONFIRMED | REJECTED
          verified_at INTEGER NOT NULL,
          confirmation_signature TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          PRIMARY KEY (owner_id, reference)  -- a reference can be credited locally only once
        );

        CREATE TABLE IF NOT EXISTS sync_queue (
          queue_id INTEGER PRIMARY KEY AUTOINCREMENT,
          owner_id TEXT NOT NULL,
          transaction_id TEXT NOT NULL,
          queued_at INTEGER NOT NULL,
          retry_after INTEGER NOT NULL DEFAULT 0,
          attempts INTEGER NOT NULL DEFAULT 0,
          UNIQUE (owner_id, transaction_id)
        );

        CREATE TABLE IF NOT EXISTS sync_log (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          owner_id TEXT NOT NULL,
          started_at INTEGER NOT NULL,
          submitted INTEGER NOT NULL,
          resolved INTEGER NOT NULL,
          ok INTEGER NOT NULL,
          latency_ms INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY NOT NULL, value TEXT);
      `);
      return db;
    })();
  }
  return dbPromise;
}

export async function getMeta(key: string): Promise<string | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ value: string }>('SELECT value FROM meta WHERE key = ?', [key]);
  return row ? row.value : null;
}

export async function setMeta(key: string, value: string) {
  const db = await getDb();
  await db.runAsync('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [key, value]);
}

export async function deleteMeta(key: string) {
  const db = await getDb();
  await db.runAsync('DELETE FROM meta WHERE key = ?', [key]);
}
