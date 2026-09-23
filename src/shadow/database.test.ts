import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  checkDatabase,
  migrate,
  openDatabase,
  openForWriting,
  openReadOnly,
  schemaVersion,
  ShadowDatabaseError,
  transaction,
  userVersion,
} from './database'

const directories: string[] = []

/** A path in a fresh temporary directory, removed after each test. */
function disposablePath() {
  const directory = mkdtempSync(join(tmpdir(), 'shadow-db-test-'))
  directories.push(directory)
  return join(directory, 'shadow.sqlite')
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

const tableNames = (db: DatabaseSync) =>
  z
    .array(z.object({ name: z.string() }))
    .parse(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all())
    .map((row) => row.name)

describe('migrations', () => {
  it('create the current schema in a fresh database', () => {
    const db = openDatabase(':memory:')

    expect(userVersion(db)).toBe(schemaVersion)
    expect(tableNames(db)).toEqual(['judgment_messages', 'judgments', 'reviews', 'runs', 'threads'])
    expect(checkDatabase(db)).toEqual([])
  })

  it('upgrade a database file from the previous, empty state', () => {
    const path = disposablePath()
    const empty = new DatabaseSync(path)
    expect(userVersion(empty)).toBe(0)
    empty.close()

    const db = openDatabase(path)

    expect(userVersion(db)).toBe(schemaVersion)
    expect(checkDatabase(db)).toEqual([])
    db.close()
  })

  it('are a no-op on an up-to-date database', () => {
    const db = openDatabase(':memory:')

    expect(() => {
      migrate(db)
    }).not.toThrow()
    expect(userVersion(db)).toBe(schemaVersion)
  })

  it('refuse a database from a newer version', () => {
    const db = new DatabaseSync(':memory:')
    db.exec(`PRAGMA user_version = ${String(schemaVersion + 1)}`)

    expect(() => {
      migrate(db)
    }).toThrow(ShadowDatabaseError)
  })

  it('enforce column types and allowed values', () => {
    const db = openDatabase(':memory:')
    const insertRun = (status: string, startedAt: string) => {
      db.exec(`INSERT INTO runs (mailbox_id, rubric, model, status, started_at)
               VALUES ('support@example.com', 'email-triage.v2', 'jev-1.13.0', '${status}', ${startedAt})`)
    }

    expect(() => {
      insertRun('done', "'2026-01-13T08:00:00Z'")
    }).toThrow(/CHECK constraint/)
    expect(() => {
      insertRun('running', "x'00'")
    }).toThrow(/cannot store BLOB value in TEXT column/)
  })
})

describe('openReadOnly', () => {
  it('gives an empty database when the file does not exist, and creates no file', () => {
    const path = disposablePath()
    const db = openReadOnly(path)

    expect(userVersion(db)).toBe(schemaVersion)
    expect(() => new DatabaseSync(path, { readOnly: true })).toThrow()
  })

  it('refuses an outdated database instead of migrating it', () => {
    const path = disposablePath()
    new DatabaseSync(path).close()

    expect(() => openReadOnly(path)).toThrow(
      expect.objectContaining({ code: 'outdated_schema', version: 0 }),
    )
  })

  it('cannot write', () => {
    const path = disposablePath()
    openDatabase(path).close()
    const db = openReadOnly(path)

    expect(() => {
      db.exec("DELETE FROM runs WHERE mailbox_id = 'x'")
    }).toThrow(/readonly/)
  })
})

describe('openForWriting', () => {
  it('writes to an existing database on the schema this build holds', () => {
    const path = disposablePath()
    openDatabase(path).close()
    const db = openForWriting(path)

    db.exec(
      "INSERT INTO runs (mailbox_id, rubric, model, status, started_at) VALUES ('m', 'r', 'v', 'running', 'now')",
    )

    expect(userVersion(db)).toBe(schemaVersion)
  })

  it('refuses an outdated database instead of migrating it, and leaves it alone', () => {
    const path = disposablePath()
    new DatabaseSync(path).close()

    expect(() => openForWriting(path)).toThrow(
      expect.objectContaining({ code: 'outdated_schema', version: 0 }),
    )
    // Refusing closed the handle it opened and changed nothing it holds.
    expect(userVersion(new DatabaseSync(path, { readOnly: true }))).toBe(0)
  })

  it('refuses a database from a newer version', () => {
    const path = disposablePath()
    const db = openDatabase(path)
    db.exec(`PRAGMA user_version = ${String(schemaVersion + 1)}`)
    db.close()

    expect(() => openForWriting(path)).toThrow(expect.objectContaining({ code: 'newer_schema' }))
  })

  it('refuses a file that is not a database at all', () => {
    const path = disposablePath()
    writeFileSync(path, 'not a database')

    expect(() => openForWriting(path)).toThrow()
  })
})

describe('transaction', () => {
  it('rolls everything back when the work fails', () => {
    const db = openDatabase(':memory:')

    expect(() =>
      transaction(db, () => {
        db.exec(`INSERT INTO runs (mailbox_id, rubric, model, status, started_at)
                 VALUES ('support@example.com', 'email-triage.v2', 'jev-1.13.0', 'running', 'now')`)
        throw new Error('synthetic failure')
      }),
    ).toThrow('synthetic failure')
    expect(db.prepare('SELECT count(*) AS n FROM runs').get()).toEqual({ n: 0 })
  })
})
