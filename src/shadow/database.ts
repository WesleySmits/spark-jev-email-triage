/**
 * The local shadow-triage database: SQLite through Node's built-in
 * `node:sqlite`, with migrations tracked in `PRAGMA user_version`.
 *
 * Stored data is limited to what review needs: mailbox, thread, and message
 * ids; scrubbed and truncated display fields; judgment values, probabilities,
 * and versions; run status and counts; provider error codes; and the human
 * reviews of stored classifications. Never bodies, attachment contents, or
 * credentials.
 *
 * Migrations are append-only. Each runs in one transaction with its version
 * bump, so a failed migration leaves the previous version intact.
 */
import { existsSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { z } from 'zod'

const migrations: readonly string[] = [
  // 1: runs, threads, judgments, the messages each judgment covered, and a
  //    placeholder for human corrections.
  `
  CREATE TABLE runs (
    id INTEGER PRIMARY KEY,
    mailbox_id TEXT NOT NULL,
    rubric TEXT NOT NULL,
    model TEXT NOT NULL,
    status TEXT NOT NULL
      CHECK (status IN ('running', 'completed', 'partial', 'failed', 'interrupted')),
    pid INTEGER,
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
  // 2: human reviews, which replace the placeholder above. A review names
  //    one judgment and the exact subject version its reviewer was shown,
  //    so the row keeps saying what was reviewed whatever is judged later.
  //    Corrections carry the labels a person chose; confirmations carry
  //    none, so a confirmation cannot read as having proposed any. The
  //    triggers make the table append-only in the database itself: a review
  //    is history, and history is neither edited nor dropped. Nothing
  //    touches `judgments`, so a review never overwrites what it reviews.
  //
  //    `corrections` goes. Nothing ever wrote a row to it, and leaving a
  //    second, unreachable place for a human decision beside `reviews`
  //    would only invite writing to the wrong one.
  `
  CREATE TABLE reviews (
    id INTEGER PRIMARY KEY,
    judgment_id INTEGER NOT NULL REFERENCES judgments (id),
    mailbox_id TEXT NOT NULL,
    message_id TEXT NOT NULL,
    thread_id TEXT NOT NULL,
    latest_message_id TEXT NOT NULL,
    rubric TEXT NOT NULL,
    classifier_version TEXT NOT NULL,
    decision TEXT NOT NULL CHECK (decision IN ('confirmed', 'corrected')),
    category TEXT,
    priority TEXT,
    reviewer TEXT NOT NULL,
    reviewed_at TEXT NOT NULL,
    CHECK ((decision = 'corrected') = (category IS NOT NULL AND priority IS NOT NULL))
  ) STRICT;

  CREATE INDEX reviews_by_copy ON reviews (mailbox_id, message_id, reviewed_at);

  CREATE TRIGGER reviews_are_never_changed BEFORE UPDATE ON reviews BEGIN
    SELECT RAISE(ABORT, 'A stored review is history and cannot be changed');
  END;

  CREATE TRIGGER reviews_are_never_removed BEFORE DELETE ON reviews BEGIN
    SELECT RAISE(ABORT, 'A stored review is history and cannot be removed');
  END;

  DROP TABLE corrections;
  `,
  // 3: the identity and result of each logical Save. A retry with the same
  // request id reads this row instead of appending another review. The row
  // and its review (or refusal) commit together, and neither can be changed.
  `
  CREATE TABLE review_requests (
    request_id TEXT PRIMARY KEY,
    payload TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('recorded', 'refused')),
    refusal_reason TEXT,
    review_id INTEGER REFERENCES reviews (id),
    CHECK ((status = 'recorded') = (review_id IS NOT NULL AND refusal_reason IS NULL)),
    CHECK ((status = 'refused') = (refusal_reason IS NOT NULL AND review_id IS NULL))
  ) STRICT;

  CREATE TRIGGER review_requests_are_never_changed BEFORE UPDATE ON review_requests BEGIN
    SELECT RAISE(ABORT, 'A review request result cannot be changed');
  END;

  CREATE TRIGGER review_requests_are_never_removed BEFORE DELETE ON review_requests BEGIN
    SELECT RAISE(ABORT, 'A review request result cannot be removed');
  END;
  `,
  // 4: explicit manual runs started by the local app. The run owns only
  //    provider identifiers, bounds and content-free status. Classifications
  //    remain in the existing versioned judgment tables and are linked via
  //    the shadow run that produced them.
  `
  CREATE TABLE manual_runs (
    id TEXT PRIMARY KEY,
    request_id TEXT NOT NULL UNIQUE,
    request_payload TEXT NOT NULL,
    source_run_id TEXT REFERENCES manual_runs (id),
    scope_kind TEXT NOT NULL CHECK (scope_kind IN ('worklist', 'mailbox', 'restart')),
    scope_label TEXT NOT NULL,
    status TEXT NOT NULL
      CHECK (status IN (
        'queued', 'running', 'stopping', 'stopped',
        'completed', 'partial', 'failed', 'interrupted'
      )),
    pid INTEGER NOT NULL,
    max_messages INTEGER NOT NULL CHECK (max_messages BETWEEN 1 AND 100),
    max_jev_calls INTEGER NOT NULL CHECK (max_jev_calls BETWEEN 1 AND 100),
    started_at TEXT NOT NULL,
    finished_at TEXT,
    error_codes TEXT NOT NULL DEFAULT '[]'
  ) STRICT;

  CREATE TABLE manual_run_items (
    manual_run_id TEXT NOT NULL REFERENCES manual_runs (id),
    position INTEGER NOT NULL CHECK (position >= 0),
    mailbox_id TEXT NOT NULL,
    mailbox_address TEXT NOT NULL,
    message_id TEXT NOT NULL,
    status TEXT NOT NULL
      CHECK (status IN (
        'queued', 'already_current', 'duplicate', 'classified',
        'provider_failure', 'read_error', 'store_error', 'deferred'
      )),
    shadow_run_id INTEGER REFERENCES runs (id),
    PRIMARY KEY (manual_run_id, position),
    UNIQUE (manual_run_id, mailbox_id, message_id)
  ) STRICT;

  CREATE INDEX manual_run_items_by_shadow_run ON manual_run_items (shadow_run_id);
  `,
  // 5: which fields of a classification each review decided. A review names
  //    one subject version and decides its fields one at a time, so a person
  //    can confirm or correct the category and the priority separately, and a
  //    field nobody reviewed stays the classifier's rather than being carried
  //    along beside one that was decided.
  //
  //    `reviews` keeps every column and every row it had. Its `decision`,
  //    `category` and `priority` say what a review came to as a whole: the
  //    labels that hold after it, where it changed any. They never said which
  //    field a person assessed, and these rows are what does.
  //
  //    Existing reviews are backfilled as the category decisions they were.
  //    The UI that wrote them asked about the category alone and carried the
  //    judged priority along to fill out the stored shape, which is no
  //    evidence that anyone assessed a priority; recording a priority
  //    decision for them would invent one nobody made. Both tables refuse an
  //    update and a delete, because a decision is history like the review
  //    that carries it.
  `
  CREATE TABLE review_fields (
    review_id INTEGER NOT NULL REFERENCES reviews (id),
    field TEXT NOT NULL CHECK (field IN ('category', 'priority')),
    decision TEXT NOT NULL CHECK (decision IN ('confirmed', 'corrected')),
    value TEXT,
    PRIMARY KEY (review_id, field),
    CHECK ((decision = 'corrected') = (value IS NOT NULL))
  ) STRICT;

  INSERT INTO review_fields (review_id, field, decision, value)
  SELECT id, 'category', decision, category FROM reviews;

  CREATE TRIGGER review_fields_are_never_changed BEFORE UPDATE ON review_fields BEGIN
    SELECT RAISE(ABORT, 'A stored review decision is history and cannot be changed');
  END;

  CREATE TRIGGER review_fields_are_never_removed BEFORE DELETE ON review_fields BEGIN
    SELECT RAISE(ABORT, 'A stored review decision is history and cannot be removed');
  END;
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
        : `Database schema ${String(version)} needs migrating; run pnpm shadow --migrate --db <path>`,
    )
  }
}

export class ShadowMigrationError extends Error {
  override readonly name = 'ShadowMigrationError'

  constructor(
    readonly code:
      'missing_database' | 'unsupported_source' | 'unhealthy_database' | 'legacy_corrections',
  ) {
    super(code)
  }
}

/** Opens and migrates a writable database. `:memory:` gives a disposable one. */
export function openDatabase(path: string): DatabaseSync {
  const db = new DatabaseSync(path)
  db.exec(`PRAGMA foreign_keys = ON; PRAGMA busy_timeout = ${String(busyTimeoutMs)}`)
  migrate(db)
  return db
}

/** How long a write waits for another process's write to finish. */
const busyTimeoutMs = 5_000

/**
 * Opens an existing database without writing to it, or an empty in-memory
 * one when the file does not exist yet. Used by dry runs.
 */
export function openReadOnly(path: string): DatabaseSync {
  if (!existsSync(path)) return openDatabase(':memory:')
  const db = new DatabaseSync(path, { readOnly: true })
  db.exec(`PRAGMA busy_timeout = ${String(busyTimeoutMs)}`)
  const version = userVersion(db)
  if (version > schemaVersion) throw new ShadowDatabaseError('newer_schema', version)
  if (version < schemaVersion) throw new ShadowDatabaseError('outdated_schema', version)
  return db
}

/**
 * Opens an existing database for writing, without migrating it. A schema
 * this build does not hold exactly is refused rather than changed: migrating
 * belongs to a `pnpm shadow --apply` run, and recording one person's review
 * is no place to alter the store that holds what they reviewed. The file
 * must already exist; nothing that only appends to a run's work creates one.
 */
export function openForWriting(path: string): DatabaseSync {
  const db = new DatabaseSync(path)
  try {
    db.exec(`PRAGMA foreign_keys = ON; PRAGMA busy_timeout = ${String(busyTimeoutMs)}`)
    const version = userVersion(db)
    if (version === schemaVersion) return db
    throw new ShadowDatabaseError(
      version > schemaVersion ? 'newer_schema' : 'outdated_schema',
      version,
    )
  } catch (error) {
    db.close()
    throw error
  }
}

export function migrate(db: DatabaseSync): void {
  const current = userVersion(db)
  if (current > schemaVersion) throw new ShadowDatabaseError('newer_schema', current)
  migrations.slice(current).forEach((sql, index) => {
    transaction(db, () => {
      applyMigration(db, sql, current + index + 1)
    })
  })
}

function applyMigration(db: DatabaseSync, sql: string, version: number): void {
  db.exec(sql)
  db.exec(`PRAGMA user_version = ${String(version)}`)
}

/** Upgrade an existing healthy older file. Never creates one. */
export function migrateExistingDatabase(path: string): 'migrated' | 'current' {
  if (!existsSync(path)) throw new ShadowMigrationError('missing_database')
  const db = new DatabaseSync(path)
  try {
    db.exec(`PRAGMA foreign_keys = ON; PRAGMA busy_timeout = ${String(busyTimeoutMs)}`)
    const version = userVersion(db)
    if (version === schemaVersion) {
      if (checkDatabase(db).length > 0) throw new ShadowMigrationError('unhealthy_database')
      return 'current'
    }
    if (version < 1 || version >= schemaVersion) {
      throw new ShadowMigrationError('unsupported_source')
    }
    transaction(db, () => {
      if (checkDatabaseHealth(db).length > 0) throw new ShadowMigrationError('unhealthy_database')

      if (version === 1) {
        // The old table was a placeholder; refuse to discard unexpected decisions.
        const corrections = db.prepare('SELECT COUNT(*) AS count FROM corrections').get()
        if (z.object({ count: z.int().nonnegative() }).parse(corrections).count > 0) {
          throw new ShadowMigrationError('legacy_corrections')
        }
      }

      migrations.slice(version).forEach((migration, index) => {
        applyMigration(db, migration, version + index + 1)
      })
      if (checkDatabase(db).length > 0) throw new ShadowMigrationError('unhealthy_database')
    })
    return 'migrated'
  } finally {
    db.close()
  }
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
  return [
    ...(userVersion(db) === schemaVersion ? [] : ['schema_version']),
    ...checkDatabaseHealth(db),
  ]
}

function checkDatabaseHealth(db: DatabaseSync): string[] {
  const integrity = db.prepare('PRAGMA integrity_check').all()
  const foreignKeys = db.prepare('PRAGMA foreign_key_check').all()
  return [
    ...(JSON.stringify(integrity) === JSON.stringify([{ integrity_check: 'ok' }])
      ? []
      : ['integrity']),
    ...(foreignKeys.length === 0 ? [] : ['foreign_keys']),
  ]
}
