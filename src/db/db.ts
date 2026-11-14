/**
 * Local SQLite store (section 3.6.1 of the report): users, wallet_cache, transactions, sync_queue.
 * Extra: `meta` (settings) and `sync_log` (data for the evaluation metrics).
 * owner_id is added so several accounts can use one device without seeing each other's records.
 */
import * as SQLite from 'expo-sqlite';

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

export function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = await SQLite.openDatabaseAsync('paybow.db');
      await db.execAsync(`
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS users (
          user_id TEXT PRIMARY KEY NOT NULL,
          display_name TEXT NOT NULL,
          account_reference TEXT,
          public_key TEXT,
          updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS wallet_cache (
          wallet_id TEXT PRIMARY KEY NOT NULL,
          user_id TEXT NOT NULL,
          cached_balance INTEGER NOT NULL,
          last_updated INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS transactions (
          owner_id TEXT NOT NULL,
          transaction_id TEXT NOT NULL,
          role TEXT NOT NULL,                -- PAYER | RECIPIENT (which side of the payment this device owner is)
          payer_id TEXT NOT NULL,
          payer_name TEXT,
          recipient_id TEXT NOT NULL,
          recipient_name TEXT,
          amount INTEGER NOT NULL,           -- kobo
          currency TEXT NOT NULL,
          timestamp INTEGER NOT NULL,
          nonce TEXT NOT NULL,
          expires_at INTEGER NOT NULL,
          signature TEXT NOT NULL,
          status TEXT NOT NULL,              -- PENDING | SYNCING | ACCEPTED | REJECTED | CONFLICT
          attempts INTEGER NOT NULL DEFAULT 0,
          last_error TEXT,
          created_at INTEGER NOT NULL,
          resolved_at INTEGER,
          PRIMARY KEY (owner_id, transaction_id)
        );
        CREATE INDEX IF NOT EXISTS idx_tx_owner_time ON transactions(owner_id, timestamp DESC);
        CREATE TABLE IF NOT EXISTS sync_queue (
          queue_id INTEGER PRIMARY KEY AUTOINCREMENT,
          owner_id TEXT NOT NULL,
          transaction_id TEXT NOT NULL,
          queued_at INTEGER NOT NULL,
          retry_after INTEGER NOT NULL DEFAULT 0,
          attempts INTEGER NOT NULL DEFAULT 0,
          UNIQUE (owner_id, transaction_id),
          FOREIGN KEY (owner_id, transaction_id) REFERENCES transactions(owner_id, transaction_id)
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
