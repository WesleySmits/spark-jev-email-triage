import type { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { mailboxCopyId, type MailboxCopyRef } from '../domain/mailbox-copy'
import type { StoredJudgment } from '../domain/stored-classification'
import { currentTriageRubric } from '../domain/triage'
import { jevModel } from '../jev/questions'
import { openDatabase } from './database'
import { defaultJudgedAt, jevFailure, jevJudgment, storeJudgments } from './fixtures'
import { readJudgments } from './judgments'

// Synthetic mail only: every address uses a reserved `.example` domain.
const one = 'one@mail.example'
const two = 'two@mail.example'

const copy = (mailboxId: string, messageId: string): MailboxCopyRef => ({ mailboxId, messageId })

const judgmentsOf = (db: DatabaseSync, ref: MailboxCopyRef) =>
  readJudgments(db, [ref]).get(mailboxCopyId(ref)) ?? []

/** What a judgment proposed, or `null` when the attempt produced nothing. */
const labelsOf = (judgment: StoredJudgment | undefined) =>
  judgment?.verdict.status === 'classified' ? judgment.verdict.labels : null

describe('readJudgments', () => {
  it('reads the judgment that covered a copy, naming the exact version it judged', () => {
    const db = openDatabase(':memory:')
    storeJudgments(db, [{ mailboxId: one, messageIds: ['11'], classification: jevJudgment('11') }])

    const [judgment] = judgmentsOf(db, copy(one, '11'))

    expect(judgment).toMatchObject({
      subject: {
        copy: copy(one, '11'),
        threadId: '11',
        latestMessageId: '11',
        rubric: currentTriageRubric,
        classifierVersion: jevModel,
      },
      threadLatestMessageId: '11',
      judgedAt: defaultJudgedAt,
    })
    expect(labelsOf(judgment)).toMatchObject({
      category: 'personal',
      priority: 'high',
      priorityUncertain: false,
      review: 'auto_accepted',
      reviewPriority: 'normal',
    })
    expect(labelsOf(judgment)?.confidence).toBeCloseTo(0.9)
  })

  it('never reads one mailbox copy of a message id as a judgment of another', () => {
    const db = openDatabase(':memory:')
    storeJudgments(db, [{ mailboxId: one, messageIds: ['11'], classification: jevJudgment('11') }])

    expect(judgmentsOf(db, copy(two, '11'))).toEqual([])
    expect(readJudgments(db, [copy(two, '11')]).size).toBe(0)
  })

  it('reads every message a judgment covered, not only the one its thread starts at', () => {
    const db = openDatabase(':memory:')
    storeJudgments(db, [
      { mailboxId: one, messageIds: ['11', '12'], classification: jevJudgment('11') },
    ])

    expect(judgmentsOf(db, copy(one, '12'))).toMatchObject([
      { subject: { copy: copy(one, '12'), threadId: '11', latestMessageId: '12' } },
    ])
  })

  it('reports the latest message the store has since observed in the thread', () => {
    const db = openDatabase(':memory:')
    storeJudgments(db, [
      { mailboxId: one, messageIds: ['11'], classification: jevJudgment('11') },
      {
        mailboxId: one,
        messageIds: ['11', '13'],
        classification: jevFailure('11'),
        judgedAt: '2026-09-21T09:00:00.000Z',
      },
    ])

    expect(judgmentsOf(db, copy(one, '11'))).toMatchObject([
      { subject: { latestMessageId: '13' }, threadLatestMessageId: '13' },
      { subject: { latestMessageId: '11' }, threadLatestMessageId: '13' },
    ])
  })

  it('reads a failed attempt as a provider failure with a content-free code', () => {
    const db = openDatabase(':memory:')
    storeJudgments(db, [{ mailboxId: one, messageIds: ['11'], classification: jevFailure('11') }])

    expect(judgmentsOf(db, copy(one, '11'))).toMatchObject([
      { verdict: { status: 'provider_failure', errorCode: 'timeout' } },
    ])
  })

  it('skips a stored judgment whose labels this build no longer knows', () => {
    const db = openDatabase(':memory:')
    storeJudgments(db, [{ mailboxId: one, messageIds: ['11'], classification: jevJudgment('11') }])
    db.prepare("UPDATE judgments SET category = 'billing'").run()

    expect(judgmentsOf(db, copy(one, '11'))).toEqual([])
  })

  it('reads the judgments of several copies at once, each under its own copy', () => {
    const db = openDatabase(':memory:')
    storeJudgments(db, [
      { mailboxId: one, messageIds: ['11'], classification: jevJudgment('11') },
      {
        mailboxId: two,
        messageIds: ['21'],
        classification: jevJudgment('21', { category: 'purchase' }),
      },
    ])

    const judgments = readJudgments(db, [copy(one, '11'), copy(two, '21'), copy(one, '99')])

    expect([...judgments.keys()]).toEqual([
      mailboxCopyId(copy(one, '11')),
      mailboxCopyId(copy(two, '21')),
    ])
    expect(judgments.get(mailboxCopyId(copy(two, '21')))).toMatchObject([
      { subject: { copy: copy(two, '21') }, verdict: { labels: { category: 'purchase' } } },
    ])
  })
})
