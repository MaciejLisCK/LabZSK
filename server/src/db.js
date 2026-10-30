// SQLite storage (node:sqlite, no external dependencies).

import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const VERSION = 3;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS attempts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  course TEXT NOT NULL,
  lab_session TEXT NOT NULL,
  task TEXT NOT NULL,
  status TEXT NOT NULL,
  session_hash TEXT,
  offline_start INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  finished_at INTEGER,
  last_seen INTEGER,
  last_seq INTEGER NOT NULL DEFAULT 0,
  mistakes INTEGER NOT NULL DEFAULT 0,
  cycles INTEGER NOT NULL DEFAULT 0,
  offline_events INTEGER NOT NULL DEFAULT 0,
  state TEXT,
  enc TEXT,
  UNIQUE (user_id, course, lab_session, task)
);
CREATE TABLE IF NOT EXISTS events (
  attempt_id TEXT NOT NULL REFERENCES attempts (id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  kind TEXT NOT NULL,
  text TEXT NOT NULL,
  client_ts INTEGER,
  received_at INTEGER NOT NULL,
  offline INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (attempt_id, seq)
);
CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  attempt_id TEXT NOT NULL REFERENCES attempts (id) ON DELETE CASCADE,
  at INTEGER NOT NULL,
  kind TEXT NOT NULL,
  detail TEXT
);
CREATE TABLE IF NOT EXISTS teachers (
  login TEXT PRIMARY KEY,
  password_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

export function openDatabase(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, 'labzsk.sqlite'));
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  const version = db.prepare('PRAGMA user_version').get().user_version;
  if (version < VERSION) {
    // version 1 (one-time tokens) held only test data; teacher accounts are kept
    if (version < 2) db.exec('DROP TABLE IF EXISTS events; DROP TABLE IF EXISTS audit; DROP TABLE IF EXISTS tokens; DROP TABLE IF EXISTS attempts;');
    else db.exec('ALTER TABLE attempts ADD COLUMN enc TEXT');
    db.exec(`PRAGMA user_version = ${VERSION}`);
  }
  db.exec(SCHEMA);
  return db;
}

/** Runs fn inside a transaction. */
export function transaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
