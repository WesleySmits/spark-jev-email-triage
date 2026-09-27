/**
 * Recorded decisions over a real database, including a real file that is
 * closed and opened again. Nothing is stood in for: what survives a restart
 * is what SQLite held after the process that wrote it went away.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  decideFollowUp,
  followUpWork,
  type FollowUpDecision,
  type FollowUpKind,
} from '../domain/follow-up'
import type { TargetObservation } from '../domain/mailbox-action'
import { mailboxCopyId, type MailboxCopyRef } from '../domain/mailbox-copy'
import { openDatabase } from './database'
import { readDecidedCopies, readFollowUpRequest, readFollowUps, recordFollowUp } from './follow-ups'

// `spark/process` is the only module that starts a process. Nothing below
// imports it, and a started process would show up here all the same.
const spawned = vi.hoisted(() => vi.fn())
vi.mock('node:child_process', () => ({ spawn: spawned }))

// Synthetic mail only: every address uses a reserved `.example` domain.
const studio = 'studio@mail.example'
const alias = 'alias@mail.example'

const copy = (mailboxId: string): MailboxCopyRef => ({ mailboxId, messageId: '11' })

interface Options {
  mailboxId?: string
  latestMessageId?: string
  dueAt?: string | null
  decidedAt?: string
}

const decide = (kind: FollowUpKind, options: Options = {}): FollowUpDecision =>
  decideFollowUp({
    target: {
      copy: copy(options.mailboxId ?? studio),
      threadId: 't-11',
      latestMessageId: options.latestMessageId ?? '11',
    },
    kind,
    dueAt: options.dueAt ?? null,
    decidedBy: 'wesley',
    decidedAt: options.decidedAt ?? '2026-09-27T09:15:00.000Z',
  })

/** What a reading that names one version of one copy observed about it. */
const observed = (mailboxId: string, latestMessageId: string): TargetObservation => ({
  copy: copy(mailboxId),
  observed: 'named',
  threadId: 't-11',
  latestMessageId,
  proven: false,
})

const storedFor = (db: DatabaseSync, mailboxId: string) =>
  readFollowUps(db, [copy(mailboxId)]).get(mailboxCopyId(copy(mailboxId))) ?? []

let directory: string
let path: string

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'follow-ups-test-'))
  path = join(directory, 'shadow-triage.sqlite')
})

afterEach(() => {
  rmSync(directory, { recursive: true, force: true })
})

/** One decision written by a process that then goes away, as a save does. */
function recordAndClose(decision: FollowUpDecision, requestId?: string) {
  const db = openDatabase(path)
  try {
    return recordFollowUp(db, decision, requestId)
  } finally {
    db.close()
  }
}

function reopened<T>(read: (db: DatabaseSync) => T): T {
  const db = openDatabase(path)
  try {
    return read(db)
  } finally {
    db.close()
  }
}

describe('recording a decision in a file', () => {
  it('keeps what a person decided after the process that wrote it is gone', () => {
    const dueAt = '2026-10-02T09:00:00.000Z'
    expect(recordAndClose(decide('follow_up_later', { dueAt }))).toEqual({ status: 'recorded' })

    const stored = reopened((db) => storedFor(db, studio))
    expect(stored).toEqual([decide('follow_up_later', { dueAt })])
    expect(followUpWork(stored, [observed(studio, '11')])).toEqual({
      state: 'open',
      decision: stored[0],
      dueAt,
    })
  })

  it('keeps every decision about a copy, latest first, and edits none of them', () => {
    recordAndClose(decide('reply_needed', { decidedAt: '2026-09-25T09:00:00.000Z' }))
    recordAndClose(decide('handled_in_spark', { decidedAt: '2026-09-26T09:00:00.000Z' }))
    recordAndClose(decide('reopen', { decidedAt: '2026-09-27T09:00:00.000Z' }))

    expect(reopened((db) => storedFor(db, studio)).map(({ kind }) => kind)).toEqual([
      'reopen',
      'handled_in_spark',
      'reply_needed',
    ])
  })

  it('keeps the order it recorded when a later save carries an earlier time', () => {
    // A clock corrected between two saves. The reopen was recorded second and
    // stamped earlier; reading by `decided_at` would leave the closure current
    // and hide the work this person reopened.
    recordAndClose(decide('handled_in_spark', { decidedAt: '2026-09-27T09:00:00.000Z' }))
    expect(recordAndClose(decide('reopen', { decidedAt: '2026-09-25T08:00:00.000Z' }))).toEqual({
      status: 'recorded',
    })

    const stored = reopened((db) => storedFor(db, studio))
    expect(stored.map(({ kind }) => kind)).toEqual(['reopen', 'handled_in_spark'])
    expect(followUpWork(stored, [observed(studio, '11')])).toMatchObject({ state: 'open' })
  })

  it('refuses to change or drop a decision in the database itself', () => {
    recordAndClose(decide('reply_needed'))
    reopened((db) => {
      expect(() => {
        db.exec("UPDATE follow_up_decisions SET kind = 'handled_in_spark'")
      }).toThrow()
      expect(() => {
        db.exec('DELETE FROM follow_up_decisions')
      }).toThrow()
      expect(storedFor(db, studio).map(({ kind }) => kind)).toEqual(['reply_needed'])
    })
  })
})

describe('a decision and the version it names', () => {
  it('never lets a decision about an earlier message describe a later one', () => {
    recordAndClose(decide('handled_in_spark', { latestMessageId: '11' }))
    const stored = reopened((db) => storedFor(db, studio))

    expect(followUpWork(stored, [observed(studio, '11')])).toMatchObject({ state: 'handled' })
    expect(followUpWork(stored, [observed(studio, '12')])).toMatchObject({
      state: 'lapsed',
      reason: 'newer_message',
    })
  })

  it('reads the work as open again once the person reopens the new version', () => {
    recordAndClose(decide('handled_in_spark', { decidedAt: '2026-09-26T09:00:00.000Z' }))
    expect(
      recordAndClose(
        decide('reopen', { latestMessageId: '12', decidedAt: '2026-09-27T09:00:00.000Z' }),
      ),
    ).toEqual({ status: 'recorded' })

    const stored = reopened((db) => storedFor(db, studio))
    expect(followUpWork(stored, [observed(studio, '12')])).toMatchObject({
      state: 'open',
      dueAt: null,
    })
  })

  it('refuses to reopen work the record does not say anybody closed', () => {
    recordAndClose(decide('reply_needed', { decidedAt: '2026-09-26T09:00:00.000Z' }))
    expect(recordAndClose(decide('reopen', { decidedAt: '2026-09-27T09:00:00.000Z' }))).toEqual({
      status: 'refused',
      reason: 'nothing_to_reopen',
    })
    expect(reopened((db) => storedFor(db, studio)).map(({ kind }) => kind)).toEqual([
      'reply_needed',
    ])
  })
})

describe('two copies of one delivery', () => {
  it('decides each mailbox copy on its own, sharing the provider message id', () => {
    recordAndClose(decide('handled_in_spark', { mailboxId: studio }))
    recordAndClose(decide('reply_needed', { mailboxId: alias }))

    reopened((db) => {
      expect(storedFor(db, studio).map(({ kind }) => kind)).toEqual(['handled_in_spark'])
      expect(storedFor(db, alias).map(({ kind }) => kind)).toEqual(['reply_needed'])
      expect(followUpWork(storedFor(db, alias), [observed(alias, '11')])).toMatchObject({
        state: 'open',
      })
    })
  })

  it('refuses to reopen one copy because another copy was closed', () => {
    recordAndClose(decide('handled_in_spark', { mailboxId: studio }))
    expect(
      recordAndClose(decide('reopen', { mailboxId: alias, decidedAt: '2026-09-27T10:00:00.000Z' })),
    ).toEqual({ status: 'refused', reason: 'nothing_to_reopen' })
  })
})

describe('one save, asked for twice', () => {
  it('records one decision and reads the first result back', () => {
    const decision = decide('reply_needed')
    expect(recordAndClose(decision, 'save-1')).toEqual({ status: 'recorded' })
    expect(recordAndClose(decision, 'save-1')).toEqual({ status: 'recorded' })

    reopened((db) => {
      expect(storedFor(db, studio)).toEqual([decision])
      expect(readFollowUpRequest(db, { decision, requestId: 'save-1' })).toEqual({
        status: 'recorded',
        decision,
      })
    })
  })

  it('refuses a second, different decision sent under one save id', () => {
    recordAndClose(decide('reply_needed'), 'save-1')
    expect(recordAndClose(decide('handled_in_spark'), 'save-1')).toEqual({
      status: 'refused',
      reason: 'request_conflict',
    })
    expect(reopened((db) => storedFor(db, studio)).map(({ kind }) => kind)).toEqual([
      'reply_needed',
    ])
  })

  it('keeps a refusal as the answer that save id was given', () => {
    expect(recordAndClose(decide('reopen'), 'save-1')).toEqual({
      status: 'refused',
      reason: 'nothing_to_reopen',
    })
    recordAndClose(decide('handled_in_spark', { decidedAt: '2026-09-27T10:00:00.000Z' }))
    expect(recordAndClose(decide('reopen'), 'save-1')).toEqual({
      status: 'refused',
      reason: 'nothing_to_reopen',
    })
  })

  it('refuses one save id used by a second person for the same decision', () => {
    const mine = decide('reply_needed')
    const theirs = { ...mine, decidedBy: 'robin' }
    expect(recordAndClose(mine, 'save-1')).toEqual({ status: 'recorded' })
    expect(recordAndClose(theirs, 'save-1')).toEqual({
      status: 'refused',
      reason: 'request_conflict',
    })
    expect(reopened((db) => storedFor(db, studio))).toEqual([mine])
  })

  it('reads a retry of one decision stamped again as the same save', () => {
    const decision = decide('reply_needed')
    expect(recordAndClose(decision, 'save-1')).toEqual({ status: 'recorded' })
    const restamped = { ...decision, decidedAt: '2026-09-27T09:16:00.000Z' }
    expect(recordAndClose(restamped, 'save-1')).toEqual({ status: 'recorded' })
    expect(reopened((db) => storedFor(db, studio))).toEqual([decision])
  })

  it('says nothing about a save id this database has never seen', () => {
    reopened((db) => {
      expect(readFollowUpRequest(db, { decision: decide('reply_needed'), requestId: 'x' })).toEqual(
        { status: 'absent' },
      )
    })
  })
})

describe('reading every copy anybody decided about', () => {
  it('lists nothing where nobody has decided anything', () => {
    expect(reopened((db) => readDecidedCopies(db))).toEqual({ copies: [], nextCursor: null })
  })

  it('survives the process that wrote it and keeps each copy’s whole history', () => {
    const closure = decide('handled_in_spark')
    const reopen = decide('reopen')
    expect(recordAndClose(closure)).toEqual({ status: 'recorded' })
    expect(recordAndClose(reopen)).toEqual({ status: 'recorded' })

    const read = reopened((db) => readDecidedCopies(db))
    expect(read.nextCursor).toBeNull()
    expect(read.copies).toEqual([{ copy: copy(studio), decisions: [reopen, closure] }])
  })

  it('keeps one delivery to an address and an alias as two copies', () => {
    expect(recordAndClose(decide('reply_needed'))).toEqual({ status: 'recorded' })
    expect(recordAndClose(decide('handled_in_spark', { mailboxId: alias }))).toEqual({
      status: 'recorded',
    })

    const { copies } = reopened((db) => readDecidedCopies(db))
    // The provider message id is the same in both; the mailbox is what tells
    // them apart, so neither copy's decision answers for the other.
    expect(copies.map(({ copy: each }) => each)).toEqual([copy(alias), copy(studio)])
    expect(copies.map(({ decisions }) => decisions[0]?.kind)).toEqual([
      'handled_in_spark',
      'reply_needed',
    ])
  })

  it('lists the most recently decided copy first, by what this database received', () => {
    // An earlier `decidedAt` on the later save: a corrected clock must not
    // put the copy decided second at the back of the list.
    expect(recordAndClose(decide('reply_needed'))).toEqual({ status: 'recorded' })
    expect(
      recordAndClose(
        decide('reply_needed', { mailboxId: alias, decidedAt: '2026-09-26T09:00:00.000Z' }),
      ),
    ).toEqual({ status: 'recorded' })

    expect(reopened((db) => readDecidedCopies(db).copies.map(({ copy: each }) => each))).toEqual([
      copy(alias),
      copy(studio),
    ])
  })

  it('pages every copy without truncating history or shifting older copies after a new save', () => {
    for (const index of [1, 2, 3]) {
      expect(
        recordAndClose(decide('reply_needed', { mailboxId: `box-${String(index)}@mail.example` })),
      ).toEqual({ status: 'recorded' })
    }
    const first = reopened((db) => readDecidedCopies(db, null, 2))
    expect(first.copies.map(({ copy: each }) => each.mailboxId)).toEqual([
      'box-3@mail.example',
      'box-2@mail.example',
    ])
    expect(first.nextCursor).toEqual({ snapshotId: 3, beforeId: 2 })

    // A later decision moves box 1 to the top of a fresh read, but must not
    // make its original copy disappear from this reading's older page.
    expect(recordAndClose(decide('follow_up_later', { mailboxId: 'box-1@mail.example' }))).toEqual({
      status: 'recorded',
    })
    const older = reopened((db) => readDecidedCopies(db, first.nextCursor, 2))
    expect(older.nextCursor).toBeNull()
    expect(older.copies.map(({ copy: each }) => each.mailboxId)).toEqual(['box-1@mail.example'])
    expect(older.copies[0]?.decisions.map(({ kind }) => kind)).toEqual([
      'follow_up_later',
      'reply_needed',
    ])
    expect(reopened((db) => readDecidedCopies(db, null, 3)).nextCursor).toBeNull()
  })
})
