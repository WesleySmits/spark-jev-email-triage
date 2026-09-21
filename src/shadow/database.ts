/**
 * The local shadow-triage database: SQLite through Node's built-in
 * `node:sqlite`, with migrations tracked in `PRAGMA user_version`.
 *
 * Stored data is limited to what review needs: mailbox, thread, and message
 * ids; scrubbed and truncated display fields; judgment values, probabilities,
 * and versions; run status and counts; provider error codes; and, later,
 * human corrections. Never bodies, attachment contents, or credentials.
 *
 * Migrations are append-only. Each runs in one transaction with its version
 * bump, so a failed migration leaves the previous version intact.
 */
import { existsSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { z } from 'zod'

const migrations: readonly string[] = [
  // 1: runs, threads, judgments, the messages each judgment covered, and
  //    human corrections.
  `
  CREATE TABLE runs (
    id INTEGER PRIMARY KEY,
    mailbox_id TEXT NOT NULL,
    rubric TEXT NOT NULL,
    model TEXT NOT NULL,
    status TEXT NOT NULL
      CHECK (status IN ('running', 'completed', 'partial', 'failed', 'interrupted')),
    started_at TEXT NOT NULL,
    finished_at TEXT,
    listed INTEGER NOT NULL DEFAULT 0,
    skipped INTEGER NOT NULL DEFAULT 0,
    duplicates INTEGER NOT NULL DEFAULT 0,
    classified INTEGER NOT NULL DEFAULT 0,
    needs_review INTEGER NOT NULL DEFAULT 0,
    provider_failures INTEGER NOT NULL DEFAULT 0,
    read_errors INTEGER NOT NULL DEFAULT 0,
    store_errors INTEGER NOT NULL DEFAULT 0,
    deferred INTEGER NOT NULL DEFAULT 0,
    error_code TEXT
  ) STRICT;

  CREATE TABLE threads (
    mailbox_id TEXT NOT NULL,
    thread_id TEXT NOT NULL,
    subject TEXT,
    sender_address TEXT NOT NULL,
    sender_name TEXT,
    latest_message_id TEXT NOT NULL,
    message_count INTEGER NOT NULL CHECK (message_count > 0),
    first_seen_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    PRIMARY KEY (mailbox_id, thread_id)
  ) STRICT;

  CREATE TABLE judgments (
    id INTEGER PRIMARY KEY,
    mailbox_id TEXT NOT NULL,
    thread_id TEXT NOT NULL,
    latest_message_id TEXT NOT NULL,
    rubric TEXT NOT NULL,
    requested_model TEXT NOT NULL,
    run_id INTEGER NOT NULL REFERENCES runs (id),
    status TEXT NOT NULL CHECK (status IN ('classified', 'provider_failure')),
    answered_model TEXT,
    input_tokens INTEGER,
    output_tokens INTEGER,
    category TEXT,
    category_confidence REAL,
    priority TEXT,
    priority_uncertain INTEGER,
    review TEXT NOT NULL CHECK (review IN ('auto_accepted', 'needs_review')),
    review_priority TEXT NOT NULL CHECK (review_priority IN ('normal', 'elevated')),
    reasons TEXT NOT NULL,
    reply_expected TEXT,
    deadline TEXT,
    suspicion_signals TEXT NOT NULL,
    answers TEXT,
    error_code TEXT,
    error_detail TEXT,
    http_status INTEGER,
    attempts INTEGER NOT NULL DEFAULT 1,
    judged_at TEXT NOT NULL,
    UNIQUE (mailbox_id, thread_id, latest_message_id, rubric, requested_model),
    FOREIGN KEY (mailbox_id, thread_id) REFERENCES threads (mailbox_id, thread_id)
  ) STRICT;

  CREATE TABLE judgment_messages (
    judgment_id INTEGER NOT NULL REFERENCES judgments (id) ON DELETE CASCADE,
    mailbox_id TEXT NOT NULL,
    message_id TEXT NOT NULL,
    PRIMARY KEY (judgment_id, message_id)
  ) STRICT;

  CREATE INDEX judgment_messages_by_message ON judgment_messages (mailbox_id, message_id);

  CREATE TABLE corrections (
    id INTEGER PRIMARY KEY,
    judgment_id INTEGER NOT NULL REFERENCES judgments (id),
    category TEXT NOT NULL,
    priority TEXT NOT NULL,
    corrected_at TEXT NOT NULL
  ) STRICT;
  `,
]

export const schemaVersion = migrations.length

export class ShadowDatabaseError extends Error {
  override readonly name = 'ShadowDatabaseError'

  constructor(
    readonly code: 'newer_schema' | 'outdated_schema',
    readonly version: number,
  ) {
    super(
      code === 'newer_schema'
        ? `Database schema ${String(version)} is newer than this app supports`
        : `Database schema ${String(version)} needs migrating; run with --apply once`,
    )
  }
}

/** Opens and migrates a writable database. `:memory:` gives a disposable one. */
export function openDatabase(path: string): DatabaseSync {
  const db = new DatabaseSync(path)
  db.exec('PRAGMA foreign_keys = ON')
  migrate(db)
  return db
}

/**
 * Opens an existing database without writing to it, or an empty in-memory
 * one when the file does not exist yet. Used by dry runs.
 */
export function openReadOnly(path: string): DatabaseSync {
  if (!existsSync(path)) return openDatabase(':memory:')
  const db = new DatabaseSync(path, { readOnly: true })
  const version = userVersion(db)
  if (version > schemaVersion) throw new ShadowDatabaseError('newer_schema', version)
  if (version < schemaVersion) throw new ShadowDatabaseError('outdated_schema', version)
  return db
}

export function migrate(db: DatabaseSync): void {
  const current = userVersion(db)
  if (current > schemaVersion) throw new ShadowDatabaseError('newer_schema', current)
  migrations.slice(current).forEach((sql, index) => {
    transaction(db, () => {
      db.exec(sql)
      db.exec(`PRAGMA user_version = ${String(current + index + 1)}`)
    })
  })
}

const userVersionRow = z.object({ user_version: z.int().nonnegative() })

export function userVersion(db: DatabaseSync): number {
  return userVersionRow.parse(db.prepare('PRAGMA user_version').get()).user_version
}

/** Runs `work` atomically: everything commits, or nothing does. */
export function transaction<T>(db: DatabaseSync, work: () => T): T {
  db.exec('BEGIN IMMEDIATE')
  try {
    const result = work()
    db.exec('COMMIT')
    return result
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

/** Problems found in a database: wrong schema version, corruption, or broken references. */
export function checkDatabase(db: DatabaseSync): string[] {
  const integrity = db.prepare('PRAGMA integrity_check').all()
  const foreignKeys = db.prepare('PRAGMA foreign_key_check').all()
  return [
    ...(userVersion(db) === schemaVersion ? [] : ['schema_version']),
    ...(JSON.stringify(integrity) === JSON.stringify([{ integrity_check: 'ok' }])
      ? []
      : ['integrity']),
    ...(foreignKeys.length === 0 ? [] : ['foreign_keys']),
  ]
}
