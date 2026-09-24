import { describe, expect, it } from 'vitest'
import {
  projectClassification,
  reviewGroundsFor,
  storedJudgmentSchema,
  verifyClassification,
  type ClassificationLabels,
  type CurrentJudge,
  type ObservedThread,
  type StoredJudgment,
} from './stored-classification'
import { currentTriageRubric } from './triage'

const copy = { mailboxId: 'one@mail.example', messageId: '11' } as const

const judge: CurrentJudge = { rubric: currentTriageRubric, classifierVersion: 'jev-1.13.0' }

const labels: ClassificationLabels = {
  category: 'personal',
  priority: 'high',
  confidence: 0.91,
  priorityUncertain: false,
  review: 'auto_accepted',
  reviewPriority: 'normal',
  grounds: { state: 'recorded', reasons: [], suspicionSignals: [] },
}

type Overrides = Readonly<{
  subject?: Partial<StoredJudgment['subject']>
  threadLatestMessageId?: string
  judgedAt?: string
  verdict?: StoredJudgment['verdict']
}>

/** A stored judgment of the copy above, uncontradicted unless told otherwise. */
function judgment({ subject, ...overrides }: Overrides = {}): StoredJudgment {
  return storedJudgmentSchema.parse({
    subject: { copy, threadId: '11', latestMessageId: '11', ...judge, ...subject },
    threadLatestMessageId: '11',
    judgedAt: '2026-09-20T09:00:00.000Z',
    verdict: { status: 'classified', labels },
    ...overrides,
  })
}

const failure = { status: 'provider_failure', errorCode: 'timeout' } as const

/** What the provider returns for that copy now, matching the judgment unless told otherwise. */
const observed = (overrides: Partial<ObservedThread> = {}): ObservedThread => ({
  copy,
  threadId: '11',
  latestMessageId: '11',
  ...overrides,
})

describe('projectClassification', () => {
  it('reads an uncontradicted judgment as unverified, never as current', () => {
    const stored = judgment()

    expect(projectClassification([stored], judge)).toEqual({
      state: 'unverified',
      subject: {
        copy,
        threadId: '11',
        latestMessageId: '11',
        rubric: currentTriageRubric,
        classifierVersion: 'jev-1.13.0',
      },
      judgedAt: '2026-09-20T09:00:00.000Z',
      labels,
    })
  })

  it('reads a judgment of an earlier message of the thread as stale', () => {
    const stored = judgment({ threadLatestMessageId: '13' })

    expect(projectClassification([stored], judge)).toMatchObject({
      state: 'stale',
      reason: 'newer_message',
      labels,
    })
  })

  it('reads a judgment made under another rubric as stale', () => {
    const stored = judgment({ subject: { rubric: 'email-triage.v1' } })

    expect(projectClassification([stored], judge)).toMatchObject({
      state: 'stale',
      reason: 'rubric',
    })
  })

  it('reads a judgment made by another classifier build as stale', () => {
    const stored = judgment({ subject: { classifierVersion: 'jev-1.12.0' } })

    expect(projectClassification([stored], judge)).toMatchObject({
      state: 'stale',
      reason: 'classifier',
    })
  })

  it('reports a failed attempt as its own state, with no category or priority', () => {
    const stored = judgment({ verdict: failure })

    expect(projectClassification([stored], judge)).toEqual({
      state: 'provider_failure',
      subject: stored.subject,
      judgedAt: stored.judgedAt,
      errorCode: 'timeout',
    })
  })

  it('keeps a stale classification when a retry for the newer version failed', () => {
    const stale = judgment({ threadLatestMessageId: '13' })
    const retried = judgment({
      subject: { latestMessageId: '13' },
      threadLatestMessageId: '13',
      judgedAt: '2026-09-21T09:00:00.000Z',
      verdict: failure,
    })

    expect(projectClassification([retried, stale], judge)).toMatchObject({
      state: 'stale',
      reason: 'newer_message',
      labels,
    })
  })

  it('ignores a failed attempt that no longer names the current version', () => {
    const stored = judgment({ subject: { rubric: 'email-triage.v1' }, verdict: failure })

    expect(projectClassification([stored], judge)).toEqual({ state: 'none' })
  })

  it('takes the newest classification the store does not contradict', () => {
    const older = judgment({ subject: { threadId: '10' } })
    const newer = judgment({
      judgedAt: '2026-09-21T09:00:00.000Z',
      verdict: { status: 'classified', labels: { ...labels, category: 'purchase' } },
    })

    expect(projectClassification([older, newer], judge)).toMatchObject({
      state: 'unverified',
      labels: { category: 'purchase' },
    })
  })

  it('keeps the given order when two judgments were stored at the same moment', () => {
    const first = judgment({ subject: { threadId: '10' } })
    const second = judgment({
      verdict: { status: 'classified', labels: { ...labels, category: 'purchase' } },
    })

    expect(projectClassification([first, second], judge)).toMatchObject({
      subject: { threadId: '10' },
      labels: { category: 'personal' },
    })
  })

  it('reads a row with nothing stored as none, which is not a failure', () => {
    expect(projectClassification([], judge)).toEqual({ state: 'none' })
  })
})

describe('verifyClassification', () => {
  const unverified = () => projectClassification([judgment()], judge)

  it('makes a judgment current when a thread just read names the version it judged', () => {
    expect(verifyClassification(unverified(), observed())).toMatchObject({
      state: 'current',
      subject: { copy, threadId: '11', latestMessageId: '11' },
      labels,
    })
  })

  it('reads a judgment as stale when the thread now ends in a later message', () => {
    expect(verifyClassification(unverified(), observed({ latestMessageId: '13' }))).toMatchObject({
      state: 'stale',
      reason: 'newer_message',
      labels,
    })
  })

  it('reads a judgment as stale when the copy now reads as another thread', () => {
    expect(verifyClassification(unverified(), observed({ threadId: '09' }))).toMatchObject({
      state: 'stale',
      reason: 'other_snapshot',
    })
  })

  it('proves nothing about a copy from a thread read for another mailbox', () => {
    const elsewhere = observed({ copy: { mailboxId: 'two@mail.example', messageId: '11' } })

    expect(verifyClassification(unverified(), elsewhere)).toMatchObject({ state: 'unverified' })
  })

  it('never promotes what the store already contradicts, or an absence', () => {
    const stale = projectClassification([judgment({ threadLatestMessageId: '13' })], judge)
    const failed = projectClassification([judgment({ verdict: failure })], judge)

    expect(verifyClassification(stale, observed())).toBe(stale)
    expect(verifyClassification(failed, observed())).toBe(failed)
    expect(verifyClassification({ state: 'none' }, observed())).toEqual({ state: 'none' })
    expect(
      verifyClassification({ state: 'unavailable', reason: 'unreadable' }, observed()),
    ).toEqual({ state: 'unavailable', reason: 'unreadable' })
  })
})

describe('reviewGroundsFor', () => {
  it('reads the grounds a run recorded for asking a person', () => {
    expect(
      reviewGroundsFor(true, ['low_category_confidence', 'suspicious'], ['payment_redirect']),
    ).toEqual({
      state: 'recorded',
      reasons: ['low_category_confidence', 'suspicious'],
      suspicionSignals: ['payment_redirect'],
    })
  })

  it('reads an accepted judgment as recorded with no grounds at all', () => {
    expect(reviewGroundsFor(false, [], [])).toEqual({
      state: 'recorded',
      reasons: [],
      suspicionSignals: [],
    })
  })

  it('reads a record that gives no ground for asking a person as unknown', () => {
    // An older or foreign run may have stored none. Reading that as "no
    // grounds" would present a review nobody can account for as if the model
    // had simply been unsure of itself.
    expect(reviewGroundsFor(true, [], [])).toEqual({ state: 'unknown' })
  })

  it('reads grounds that contradict the review need beside them as unknown', () => {
    expect(reviewGroundsFor(false, ['low_category_confidence'], [])).toEqual({ state: 'unknown' })
  })

  it('reads a code this build does not know as unknown, never as a partial set', () => {
    // A judgment from a build with another rule is not a judgment on the rules
    // this one happens to recognise in it.
    expect(reviewGroundsFor(true, ['low_category_confidence', 'an_unknown_rule'], [])).toEqual({
      state: 'unknown',
    })
    expect(reviewGroundsFor(true, ['suspicious'], ['an_unknown_signal'])).toEqual({
      state: 'unknown',
    })
  })

  it('reads anything that is not a list of codes as unknown', () => {
    // `provider_failure` is a ground of the failed attempt, which proposes no
    // labels: it can never be a classification's own.
    for (const reasons of [null, undefined, 'suspicious', [1], [['suspicious']], {}, ['']]) {
      expect(reviewGroundsFor(true, reasons, [])).toEqual({ state: 'unknown' })
    }
    expect(reviewGroundsFor(true, ['provider_failure'], [])).toEqual({ state: 'unknown' })
    expect(reviewGroundsFor(false, [], 'none')).toEqual({ state: 'unknown' })
  })

  it('keeps grounds out of a judgment that proposed no labels', () => {
    // A failure carries no labels, so it carries no grounds either.
    const failed = projectClassification([judgment({ verdict: failure })], judge)

    expect(failed).toEqual({
      subject: judgment().subject,
      judgedAt: judgment().judgedAt,
      state: 'provider_failure',
      errorCode: 'timeout',
    })
  })
})
