/**
 * Reviews over a real, temporary database: the rows one `--apply` run would
 * have written, and then a person's reading of them. Nothing is stood in
 * for, because nothing outside this database is involved.
 */
import { readFileSync } from 'node:fs'
import type { DatabaseSync } from 'node:sqlite'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { mailboxCopyId, type MailboxCopyRef } from '../domain/mailbox-copy'
import { effectiveOutcome, humanReviewSchema, type HumanReview } from '../domain/review'
import {
  projectClassification,
  type CurrentJudge,
  type StoredJudgment,
} from '../domain/stored-classification'
import { currentTriageRubric } from '../domain/triage'
import { jevModel } from '../jev/questions'
import { openDatabase } from './database'
import { jevFailure, jevJudgment, storeJudgments } from './fixtures'
import { readJudgments } from './judgments'
import { readReviews, recordReview } from './reviews'

// `spark/process` is the only module that starts a process. Nothing below
// imports it, and a started process would show up here all the same.
const spawned = vi.hoisted(() => vi.fn())
vi.mock('node:child_process', () => ({ spawn: spawned }))

// Synthetic mail only: every address uses a reserved `.example` domain.
const one = 'one@mail.example'
const two = 'two@mail.example'

const judge: CurrentJudge = { rubric: currentTriageRubric, classifierVersion: jevModel }

const copy = (mailboxId: string, messageId: string): MailboxCopyRef => ({ mailboxId, messageId })

/** The subject of the judgment a run stored for a copy of thread `11`. */
const subject = (mailboxId: string, latestMessageId = '11') => ({
  copy: copy(mailboxId, '11'),
  threadId: '11',
  latestMessageId,
  rubric: currentTriageRubric,
  classifierVersion: jevModel,
})

interface ReviewOptions {
  classification?: HumanReview['classification']
  verdict?: HumanReview['verdict']
  reviewedAt?: string
}

function review({ classification = subject(one), ...rest }: ReviewOptions = {}): HumanReview {
  return humanReviewSchema.parse({
    classification,
    verdict: { decision: 'confirmed' },
    reviewer: 'wesley',
    reviewedAt: '2026-09-21T10:00:00.000Z',
    ...rest,
  })
}

const correction = {
  decision: 'corrected',
  labels: { category: 'suspicious', priority: 'urgent' },
} as const

/** One classified judgment of thread `11`, as one run would have stored it. */
function judged(): DatabaseSync {
  const db = openDatabase(':memory:')
  storeJudgments(db, [{ mailboxId: one, messageIds: ['11'], classification: jevJudgment('11') }])
  return db
}

const judgmentRows = (db: DatabaseSync) => db.prepare('SELECT * FROM judgments').all()

const reviewsOf = (db: DatabaseSync, ref: MailboxCopyRef) =>
  readReviews(db, [ref]).get(mailboxCopyId(ref)) ?? []

const judgmentsOf = (db: DatabaseSync, ref: MailboxCopyRef): readonly StoredJudgment[] =>
  readJudgments(db, [ref]).get(mailboxCopyId(ref)) ?? []

/** A row written straight to the table, as another writer might leave one. */
const insertRow = (
  db: DatabaseSync,
  row: { decision: string; category: string; priority: string; reviewedAt: string },
) => {
  db.exec(
    `INSERT INTO reviews (
       judgment_id, mailbox_id, message_id, thread_id, latest_message_id, rubric,
       classifier_version, decision, category, priority, reviewer, reviewed_at
     ) SELECT id, '${one}', '11', '11', '11', '${currentTriageRubric}', '${jevModel}',
       '${row.decision}', ${row.category}, ${row.priority}, 'wesley', '${row.reviewedAt}'
     FROM judgments`,
  )
}

/** The times the table holds, as written, oldest row first. */
const storedTimes = (db: DatabaseSync) =>
  z
    .array(z.object({ reviewed_at: z.string() }))
    .parse(db.prepare('SELECT reviewed_at FROM reviews ORDER BY id').all())
    .map((row) => row.reviewed_at)

const timesOf = (db: DatabaseSync, ref: MailboxCopyRef) =>
  reviewsOf(db, ref).map((stored) => stored.reviewedAt)

const countOf = (db: DatabaseSync, table: string) =>
  z.object({ n: z.int() }).parse(db.prepare(`SELECT count(*) AS n FROM ${table}`).get()).n

describe('recordReview', () => {
  it('keeps a confirmation and the correction that followed it, newest first', () => {
    const db = judged()

    expect(recordReview(db, review(), judge)).toEqual({ status: 'recorded' })
    expect(
      recordReview(
        db,
        review({ verdict: correction, reviewedAt: '2026-09-22T11:00:00.000Z' }),
        judge,
      ),
    ).toEqual({ status: 'recorded' })

    expect(reviewsOf(db, copy(one, '11'))).toEqual([
      review({ verdict: correction, reviewedAt: '2026-09-22T11:00:00.000Z' }),
      review(),
    ])
  })

  it('leaves the classification it reviews exactly as the run stored it', () => {
    const db = judged()
    const before = judgmentRows(db)

    recordReview(db, review({ verdict: correction }), judge)

    expect(judgmentRows(db)).toEqual(before)
    expect(judgmentsOf(db, copy(one, '11'))).toHaveLength(1)
  })

  it('refuses a review of a subject the store has moved past, and writes nothing', () => {
    const db = openDatabase(':memory:')
    // A later run saw message `12` in the same thread. Asking again failed,
    // so the classification of `11` is the newest one there is, and the
    // store still contradicts it: nobody may confirm it as current.
    storeJudgments(db, [
      { mailboxId: one, messageIds: ['11'], classification: jevJudgment('11') },
      { mailboxId: one, messageIds: ['11', '12'], classification: jevFailure('11') },
    ])

    expect(recordReview(db, review(), judge)).toEqual({
      status: 'refused',
      reason: 'stale_subject',
    })
    expect(countOf(db, 'reviews')).toBe(0)
  })

  it('refuses a review that names another version than the stored one', () => {
    const db = judged()

    expect(recordReview(db, review({ classification: subject(one, '12') }), judge)).toEqual({
      status: 'refused',
      reason: 'stale_subject',
    })
    expect(countOf(db, 'reviews')).toBe(0)
  })

  it('refuses a review of a copy nothing has classified', () => {
    const db = judged()

    expect(recordReview(db, review({ classification: subject(two) }), judge)).toEqual({
      status: 'refused',
      reason: 'unclassified',
    })
  })

  it('refuses a review under another rubric or classifier build than the current one', () => {
    const db = judged()

    expect(recordReview(db, review(), { ...judge, rubric: 'email-triage.v3' })).toEqual({
      status: 'refused',
      reason: 'stale_subject',
    })
    expect(recordReview(db, review(), { ...judge, classifierVersion: 'jev-1.14.0' })).toEqual({
      status: 'refused',
      reason: 'stale_subject',
    })
  })

  // The same two moments in two offsets. As text the `+02:00` correction
  // reads as the later of the two, and it happened an hour before the
  // confirmation that followed it.
  it('stores every review in UTC, so the table orders by when a review happened', () => {
    const db = judged()

    recordReview(
      db,
      review({ verdict: correction, reviewedAt: '2026-09-21T12:00:00+02:00' }),
      judge,
    )
    recordReview(db, review({ reviewedAt: '2026-09-21T11:00:00Z' }), judge)

    expect(storedTimes(db)).toEqual(['2026-09-21T10:00:00.000Z', '2026-09-21T11:00:00.000Z'])
    expect(timesOf(db, copy(one, '11'))).toEqual([
      '2026-09-21T11:00:00.000Z',
      '2026-09-21T10:00:00.000Z',
    ])
  })

  it('runs no Spark command and reaches no classifier', () => {
    const db = judged()

    recordReview(db, review(), judge)
    readReviews(db, [copy(one, '11')])

    expect(spawned).not.toHaveBeenCalled()
    const source = readFileSync(new URL('./reviews.ts', import.meta.url), 'utf8')
    expect(source).not.toMatch(/from '\.\.\/(spark|jev)\//)
  })
})

describe('the stored reviews', () => {
  it('cannot be changed or removed once written', () => {
    const db = judged()
    recordReview(db, review(), judge)

    expect(() => {
      db.exec("UPDATE reviews SET reviewer = 'someone else'")
    }).toThrow(/cannot be changed/)
    expect(() => {
      db.exec('DELETE FROM reviews')
    }).toThrow(/cannot be removed/)
    expect(reviewsOf(db, copy(one, '11'))).toEqual([review()])
  })

  it('never let a confirmation carry labels, or a correction go without them', () => {
    const db = judged()
    const reviewedAt = '2026-09-21T10:00:00.000Z'

    expect(() => {
      insertRow(db, { decision: 'corrected', category: 'NULL', priority: 'NULL', reviewedAt })
    }).toThrow(/CHECK constraint/)
    expect(() => {
      insertRow(db, {
        decision: 'confirmed',
        category: "'suspicious'",
        priority: "'urgent'",
        reviewedAt,
      })
    }).toThrow(/CHECK constraint/)
  })

  // This module writes UTC, so only another writer can leave one in some
  // other offset. It still has to read as the moment it names.
  it('order by when a review happened, not by how its time was written', () => {
    const db = judged()
    insertRow(db, {
      decision: 'confirmed',
      category: 'NULL',
      priority: 'NULL',
      reviewedAt: '2026-09-21T12:00:00+02:00',
    })

    recordReview(db, review({ reviewedAt: '2026-09-21T11:00:00Z' }), judge)

    expect(timesOf(db, copy(one, '11'))).toEqual([
      '2026-09-21T11:00:00.000Z',
      '2026-09-21T10:00:00.000Z',
    ])
  })

  it('never lend one mailbox copy of a message id to another', () => {
    const db = openDatabase(':memory:')
    storeJudgments(db, [
      { mailboxId: one, messageIds: ['11'], classification: jevJudgment('11') },
      { mailboxId: two, messageIds: ['11'], classification: jevJudgment('11') },
    ])
    recordReview(db, review(), judge)

    expect(reviewsOf(db, copy(one, '11'))).toHaveLength(1)
    expect(reviewsOf(db, copy(two, '11'))).toEqual([])
  })
})

describe('readReviews', () => {
  it('reads back what decides the outcome of the classification reviewed', () => {
    const db = judged()
    recordReview(db, review({ verdict: correction }), judge)

    const classification = projectClassification(judgmentsOf(db, copy(one, '11')), judge)

    expect(effectiveOutcome(classification, reviewsOf(db, copy(one, '11')))).toMatchObject({
      decidedBy: 'reviewer',
      decision: 'corrected',
      labels: { category: 'suspicious', priority: 'urgent' },
    })
  })

  it('reports a copy nobody reviewed as absent rather than as an error', () => {
    const db = judged()

    expect(readReviews(db, [copy(one, '11')]).size).toBe(0)
  })
})
