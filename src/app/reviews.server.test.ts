/**
 * Recording one review against a real, temporary shadow database. Nothing is
 * stood in for below the write itself: the domain's admission rules, the
 * append-only table and its triggers are all the real ones, so these tests
 * show that the application's only write reaches those protections.
 *
 * `domain/review.test.ts` owns the admission rules and `shadow/reviews.test.ts`
 * the store; nothing here restates them. What is tested here is what this
 * module decides: where the database is, who the reviewer is, when the review
 * happened, and that a write which did not go through is never reported as one
 * that did.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir, userInfo } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { mailboxCopyId } from '../domain/mailbox-copy'
import { currentTriageRubric } from '../domain/triage'
import { jevModel } from '../jev/questions'
import { databasePathVariable } from '../shadow/config'
import { openDatabase } from '../shadow/database'
import { jevFailure, jevJudgment, storeJudgments, type StoredEntry } from '../shadow/fixtures'
import { readReviews } from '../shadow/reviews'
import type { DeskReviewRequest } from './desk-review'
import type * as StoredClassifications from './stored-classifications.server'
import { localReviewer, storeReview } from './reviews.server'

// `spark/process` is the only module that starts a process. Recording a
// review must reach neither it nor a classifier, and a started process
// would show up here all the same.
const spawned = vi.hoisted(() => vi.fn())
vi.mock('node:child_process', () => ({ spawn: spawned }))

// The one thing that runs after a review is committed. A real database
// cannot be made to fail there on demand, so the readback itself is made to,
// over a store that really was written.
const readback = vi.hoisted(() => ({ failing: false }))

vi.mock('./stored-classifications.server', async (importOriginal) => {
  const actual = await importOriginal<typeof StoredClassifications>()
  return {
    ...actual,
    storedReviewFor: (...args: Parameters<typeof actual.storedReviewFor>) => {
      if (readback.failing) throw new Error('The store could not be read back')
      return actual.storedReviewFor(...args)
    },
  }
})

// Synthetic mail only: every address uses a reserved `.example` domain.
const one = 'one@mail.example'
const two = 'two@mail.example'

const subject = (mailboxId: string, latestMessageId = '11') => ({
  copy: { mailboxId, messageId: '11' },
  threadId: '11',
  latestMessageId,
  rubric: currentTriageRubric,
  classifierVersion: jevModel,
})

const confirm = (mailboxId = one): DeskReviewRequest => ({
  classification: subject(mailboxId),
  verdict: { decision: 'confirmed' },
})

const correct: DeskReviewRequest = {
  classification: subject(one),
  verdict: { decision: 'corrected', labels: { category: 'suspicious', priority: 'urgent' } },
}

let directory: string
let databasePath: string
let env: Record<string, string | undefined>

beforeEach(() => {
  spawned.mockReset()
  readback.failing = false
  directory = mkdtempSync(join(tmpdir(), 'reviews-server-test-'))
  databasePath = join(directory, 'shadow.sqlite')
  env = { [databasePathVariable]: databasePath }
})

afterEach(() => {
  rmSync(directory, { recursive: true, force: true })
})

/** Stores judgments the way one `pnpm shadow --apply` run does. */
function shadowRun(entries: readonly StoredEntry[]) {
  const db = openDatabase(databasePath)
  try {
    storeJudgments(db, entries)
  } finally {
    db.close()
  }
}

const judged = () => {
  shadowRun([{ mailboxId: one, messageIds: ['11'], classification: jevJudgment('11') }])
}

/** The reviews the store now holds for one copy, newest first. */
function stored(mailboxId = one) {
  const db = new DatabaseSync(databasePath, { readOnly: true })
  try {
    const copy = { mailboxId, messageId: '11' }
    return readReviews(db, [copy]).get(mailboxCopyId(copy)) ?? []
  } finally {
    db.close()
  }
}

const at = (iso: string) => () => new Date(iso)

describe('storeReview', () => {
  it('appends a confirmation beside the judgment, naming this computer and this moment', () => {
    judged()

    // It answers with what a reading would now project for that row, read
    // back from the store rather than assembled from what was just written.
    expect(storeReview(confirm(), env, at('2026-09-23T08:30:00.000Z'))).toEqual({
      status: 'recorded',
      review: {
        decidedBy: 'reviewer',
        decision: 'confirmed',
        // A confirmation carries no labels of its own, so these are the
        // classifier's, exactly as the row already showed them.
        labels: { category: 'personal', priority: 'high' },
        reviewer: localReviewer(),
        reviewedAt: '2026-09-23T08:30:00.000Z',
      },
    })
    expect(stored()).toEqual([
      {
        classification: subject(one),
        verdict: { decision: 'confirmed' },
        reviewer: localReviewer(),
        reviewedAt: '2026-09-23T08:30:00.000Z',
      },
    ])
  })

  it('keeps a correction and the confirmation it followed, both readable afterwards', () => {
    judged()

    storeReview(confirm(), env, at('2026-09-23T08:30:00.000Z'))
    expect(storeReview(correct, env, at('2026-09-23T09:00:00.000Z'))).toMatchObject({
      status: 'recorded',
      review: { decision: 'corrected', labels: { category: 'suspicious', priority: 'urgent' } },
    })

    expect(stored().map((review) => review.verdict.decision)).toEqual(['corrected', 'confirmed'])
  })

  it('refuses a review of a version the store has moved past, and writes nothing', () => {
    // A later run saw message `12` in the same thread, so the version the
    // reviewer was shown is no longer the one this row holds.
    shadowRun([
      { mailboxId: one, messageIds: ['11'], classification: jevJudgment('11') },
      { mailboxId: one, messageIds: ['11', '12'], classification: jevFailure('11') },
    ])

    expect(storeReview(confirm(), env)).toEqual({ status: 'refused', reason: 'stale_subject' })
    expect(stored()).toEqual([])
  })

  it('refuses a review of a copy in another mailbox, which no judgment covers', () => {
    judged()

    expect(storeReview(confirm(two), env)).toEqual({ status: 'refused', reason: 'unclassified' })
    expect(stored(two)).toEqual([])
  })

  it('refuses a review when no run has stored anything, and creates no database for it', () => {
    expect(storeReview(confirm(), env)).toEqual({ status: 'refused', reason: 'unclassified' })
    expect(() => new DatabaseSync(databasePath, { readOnly: true })).toThrow()
  })

  it('reports a store it cannot open as failed, never as a recorded review', () => {
    writeFileSync(databasePath, 'not a database')

    expect(storeReview(confirm(), env)).toEqual({ status: 'failed' })
  })

  it('refuses to migrate a database a run has not brought up to date', () => {
    new DatabaseSync(databasePath).close()

    expect(storeReview(confirm(), env)).toEqual({ status: 'failed' })
    // What it holds is left exactly as it was, schema included.
    const db = new DatabaseSync(databasePath, { readOnly: true })
    expect(
      z.object({ user_version: z.int() }).parse(db.prepare('PRAGMA user_version').get()),
    ).toEqual({
      user_version: 0,
    })
  })

  it('reports a request it cannot read as failed, and stores nothing', () => {
    judged()
    const impossible = {
      classification: subject(one),
      verdict: {
        decision: 'corrected',
        labels: { category: 'not-a-category', priority: 'urgent' },
      },
    } as unknown as DeskReviewRequest

    expect(storeReview(impossible, env)).toEqual({ status: 'failed' })
    expect(stored()).toEqual([])
  })

  it('reports a review it committed as recorded, even when reading it back fails', () => {
    judged()
    readback.failing = true

    // The review is history the database itself refuses to change, so what
    // fails afterwards cannot take it back. Only the projection is lost.
    expect(storeReview(confirm(), env, at('2026-09-23T08:30:00.000Z'))).toEqual({
      status: 'recorded',
    })
    expect(stored()).toMatchObject([{ verdict: { decision: 'confirmed' } }])
  })

  it('never invites a second write of a review it already stored', () => {
    judged()
    readback.failing = true

    // Reported as stored, so nothing offers to try again; were it reported
    // as failed, a retry would append the same decision a second time.
    const outcome = storeReview(confirm(), env, at('2026-09-23T08:30:00.000Z'))

    expect(outcome.status).toBe('recorded')
    expect(stored()).toHaveLength(1)
  })

  it('still reports a failure that happened before anything was written', () => {
    judged()
    readback.failing = true
    const impossible = {
      classification: subject(one),
      verdict: { decision: 'corrected', labels: { category: 'not-a-category', priority: 'low' } },
    } as unknown as DeskReviewRequest

    expect(storeReview(impossible, env)).toEqual({ status: 'failed' })
    expect(stored()).toEqual([])
  })

  it('runs no Spark command and reaches no classifier', () => {
    judged()

    storeReview(confirm(), env)

    expect(spawned).not.toHaveBeenCalled()
  })
})

describe('localReviewer', () => {
  it('names the account of this computer, never a mailbox address', () => {
    expect(localReviewer()).toBe(userInfo().username)
    expect(localReviewer()).not.toContain('@')
  })
})
