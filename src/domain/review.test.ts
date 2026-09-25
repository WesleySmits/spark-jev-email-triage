import { describe, expect, it } from 'vitest'
import { admitReview, effectiveOutcome, humanReviewSchema, type HumanReview } from './review'
import type { ClassificationLabels, StoredClassification } from './stored-classification'
import { currentTriageRubric } from './triage'

// Synthetic mail only: every address uses a reserved `.example` domain.
const copy = { mailboxId: 'one@mail.example', messageId: '11' } as const

const subject = {
  copy,
  threadId: '11',
  latestMessageId: '11',
  rubric: currentTriageRubric,
  classifierVersion: 'jev-1.13.0',
} as const

const labels: ClassificationLabels = {
  category: 'notification',
  priority: 'low',
  confidence: 0.91,
  priorityUncertain: false,
  review: 'auto_accepted',
  reviewPriority: 'normal',
  grounds: { state: 'recorded', reasons: [], suspicionSignals: [] },
}

const judgedAt = '2026-09-20T09:00:00.000Z'

/** What the store holds for the copy: the judgment above, uncontradicted. */
const unverified: StoredClassification = { state: 'unverified', subject, judgedAt, labels }

/** A review of that classification, confirming its category unless told otherwise. */
function review(overrides: Partial<HumanReview> = {}): HumanReview {
  return humanReviewSchema.parse({
    classification: subject,
    verdict: { category: { decision: 'confirmed' } },
    reviewer: 'wesley',
    reviewedAt: '2026-09-21T10:00:00.000Z',
    ...overrides,
  })
}

/** A correction of both fields at once, as one person deciding both. */
const corrected = (category: 'personal' | 'suspicious', priority: 'urgent' | 'high') => ({
  category: { decision: 'corrected' as const, value: category },
  priority: { decision: 'corrected' as const, value: priority },
})

const confirmedOn = (reviewedAt: string) => ({
  decision: 'confirmed',
  reviewer: 'wesley',
  reviewedAt,
})

const correctedOn = (reviewedAt: string) => ({
  decision: 'corrected',
  reviewer: 'wesley',
  reviewedAt,
})

describe('humanReviewSchema', () => {
  it('names one classification, by the version it judged', () => {
    expect(review().classification).toEqual(subject)
  })

  it('refuses a confirmed field that carries a value of its own', () => {
    const result = humanReviewSchema.safeParse({
      classification: subject,
      verdict: { category: { decision: 'confirmed', value: 'personal' } },
      reviewer: 'wesley',
      reviewedAt: '2026-09-21T10:00:00.000Z',
    })

    expect(result.success).toBe(false)
  })

  it('keeps a time written in any offset as the instant it names', () => {
    expect(review({ reviewedAt: '2026-09-21T12:00:00+02:00' }).reviewedAt).toBe(
      '2026-09-21T10:00:00.000Z',
    )
  })

  it('takes a decision about either field on its own, or about both', () => {
    for (const verdict of [
      { category: { decision: 'confirmed' } },
      { priority: { decision: 'corrected', value: 'urgent' } },
      {
        category: { decision: 'corrected', value: 'personal' },
        priority: { decision: 'confirmed' },
      },
    ]) {
      expect(humanReviewSchema.safeParse({ ...review(), verdict }).success).toBe(true)
    }
  })

  it('refuses a review that decides no field at all', () => {
    expect(humanReviewSchema.safeParse({ ...review(), verdict: {} }).success).toBe(false)
  })

  it('refuses a correction that chooses no value, and an unnamed reviewer', () => {
    expect(
      humanReviewSchema.safeParse({ ...review(), verdict: { category: { decision: 'corrected' } } })
        .success,
    ).toBe(false)
    expect(humanReviewSchema.safeParse({ ...review(), reviewer: '  ' }).success).toBe(false)
  })

  // What a person will do about a message is a work decision, not a label the
  // classifier proposed for confirmation. A verdict that named one would read
  // as an assessed Jev label, so the shape refuses it outright.
  it('refuses a verdict about a reply expectation or a deadline', () => {
    for (const verdict of [
      { category: { decision: 'confirmed' }, replyExpected: { decision: 'confirmed' } },
      { deadline: { decision: 'corrected', value: '2026-09-30' } },
    ]) {
      expect(humanReviewSchema.safeParse({ ...review(), verdict }).success).toBe(false)
    }
  })
})

describe('admitReview', () => {
  it('admits a review of the classification the store holds for the copy', () => {
    expect(admitReview(review(), unverified)).toEqual({ status: 'admitted' })
    expect(admitReview(review({ verdict: corrected('personal', 'high') }), unverified)).toEqual({
      status: 'admitted',
    })
  })

  it('admits a review of a classification a read has proven current', () => {
    expect(admitReview(review(), { ...unverified, state: 'current' })).toEqual({
      status: 'admitted',
    })
  })

  it('refuses a review of a classification the store has moved past', () => {
    const stale: StoredClassification = { ...unverified, state: 'stale', reason: 'newer_message' }

    expect(admitReview(review(), stale)).toEqual({ status: 'refused', reason: 'stale_subject' })
  })

  // Staleness is about the version reviewed, so which field a person decided
  // makes no difference: they read the outdated judgment either way.
  it('refuses a priority decision about a classification that has moved past', () => {
    const stale: StoredClassification = { ...unverified, state: 'stale', reason: 'classifier' }
    const priority = review({ verdict: { priority: { decision: 'corrected', value: 'urgent' } } })

    expect(admitReview(priority, stale)).toEqual({ status: 'refused', reason: 'stale_subject' })
  })

  // The reviewer read a version, and the store holds another: an earlier
  // message, or a judgment under a rubric or classifier build since bumped.
  it('refuses a review that names a version other than the one stored', () => {
    for (const named of [
      { ...subject, latestMessageId: '10' },
      { ...subject, threadId: '10' },
      { ...subject, rubric: 'email-triage.v1' },
      { ...subject, classifierVersion: 'jev-1.12.0' },
    ]) {
      expect(admitReview(review({ classification: named }), unverified)).toEqual({
        status: 'refused',
        reason: 'stale_subject',
      })
    }
  })

  it('refuses a review when nothing stored classifies the copy', () => {
    const failed: StoredClassification = {
      state: 'provider_failure',
      subject,
      judgedAt,
      errorCode: 'timeout',
    }

    expect(admitReview(review(), { state: 'none' })).toEqual({
      status: 'refused',
      reason: 'unclassified',
    })
    expect(admitReview(review(), failed)).toEqual({
      status: 'refused',
      reason: 'unclassified',
    })
  })

  it('refuses a review while what the store holds cannot be read', () => {
    expect(admitReview(review(), { state: 'unavailable', reason: 'unreadable' })).toEqual({
      status: 'refused',
      reason: 'unreadable',
    })
  })

  // One delivery to two aliases is two copies, and neither reviews the other.
  it('refuses a review of one mailbox copy against another copy', () => {
    const other = { ...subject, copy: { mailboxId: 'two@mail.example', messageId: '11' } }

    expect(admitReview(review({ classification: other }), unverified)).toEqual({
      status: 'refused',
      reason: 'other_copy',
    })
  })
})

describe('effectiveOutcome', () => {
  it('shows what the classifier proposed while nobody has reviewed it', () => {
    expect(effectiveOutcome(unverified, [])).toEqual({
      decidedBy: 'classifier',
      labels: { category: 'notification', priority: 'low' },
    })
  })

  it('keeps the classifier label a person confirmed, and says who confirmed it', () => {
    expect(effectiveOutcome(unverified, [review()])).toEqual({
      decidedBy: 'reviewer',
      decision: 'confirmed',
      labels: { category: 'notification' },
      fields: { category: confirmedOn('2026-09-21T10:00:00.000Z') },
      reviewer: 'wesley',
      reviewedAt: '2026-09-21T10:00:00.000Z',
    })
  })

  // The field nobody decided is left to the classifier, and is absent here
  // rather than carried along: a priority in a person's outcome would read as
  // a priority they assessed.
  it('carries no field a review did not decide', () => {
    const category = effectiveOutcome(unverified, [
      review({ verdict: { category: { decision: 'corrected', value: 'personal' } } }),
    ])
    const priority = effectiveOutcome(unverified, [
      review({ verdict: { priority: { decision: 'corrected', value: 'urgent' } } }),
    ])

    expect(category).toMatchObject({ decision: 'corrected', labels: { category: 'personal' } })
    expect(category).not.toHaveProperty('labels.priority')
    expect(category).not.toHaveProperty('fields.priority')
    expect(priority).toMatchObject({ decision: 'corrected', labels: { priority: 'urgent' } })
    expect(priority).not.toHaveProperty('labels.category')
    expect(priority).not.toHaveProperty('fields.category')
  })

  // Each field is its own decision, so reviewing one leaves the other's
  // decision exactly where it was, whoever made it and whenever.
  it('decides each field by the latest review that named that field', () => {
    const category = review({
      verdict: { category: { decision: 'corrected', value: 'personal' } },
      reviewedAt: '2026-09-21T10:00:00.000Z',
    })
    const priority = review({
      verdict: { priority: { decision: 'confirmed' } },
      reviewer: 'sam',
      reviewedAt: '2026-09-22T11:00:00.000Z',
    })

    expect(effectiveOutcome(unverified, [priority, category])).toEqual({
      decidedBy: 'reviewer',
      decision: 'corrected',
      labels: { category: 'personal', priority: 'low' },
      fields: {
        category: {
          decision: 'corrected',
          reviewer: 'wesley',
          reviewedAt: '2026-09-21T10:00:00.000Z',
        },
        priority: {
          decision: 'confirmed',
          reviewer: 'sam',
          reviewedAt: '2026-09-22T11:00:00.000Z',
        },
      },
      reviewer: 'sam',
      reviewedAt: '2026-09-22T11:00:00.000Z',
    })
  })

  it('prefers the latest review of a field, whichever way round the two came', () => {
    const confirmation = review({ reviewedAt: '2026-09-21T10:00:00.000Z' })
    const correction = review({
      verdict: corrected('suspicious', 'urgent'),
      reviewedAt: '2026-09-22T11:00:00.000Z',
    })

    expect(effectiveOutcome(unverified, [correction, confirmation])).toMatchObject({
      decision: 'corrected',
      labels: { category: 'suspicious', priority: 'urgent' },
      reviewedAt: '2026-09-22T11:00:00.000Z',
    })
    const later = review({ reviewedAt: '2026-09-23T09:00:00.000Z' })
    expect(effectiveOutcome(unverified, [correction, later])).toMatchObject({
      decision: 'corrected',
      labels: { category: 'notification', priority: 'urgent' },
      fields: {
        category: confirmedOn('2026-09-23T09:00:00.000Z'),
        priority: correctedOn('2026-09-22T11:00:00.000Z'),
      },
      reviewedAt: '2026-09-23T09:00:00.000Z',
    })
  })

  // Two moments written in two offsets, as a caller that builds its reviews
  // rather than parsing them may still hand them over. As text the `+02:00`
  // correction reads as the later of the two, and it happened an hour before
  // the confirmation: sorting on the spelling would let it win.
  it('prefers the review that happened last, whatever offset it was written in', () => {
    const abroad: HumanReview = {
      ...review({ verdict: { category: { decision: 'corrected', value: 'suspicious' } } }),
      reviewedAt: '2026-09-21T12:00:00+02:00',
    }
    const after = review({ reviewedAt: '2026-09-21T11:00:00Z' })

    expect(effectiveOutcome(unverified, [abroad, after])).toMatchObject({
      decision: 'confirmed',
      labels: { category: 'notification' },
      reviewedAt: '2026-09-21T11:00:00.000Z',
    })
  })

  // It stays stored and keeps describing the version its reviewer read; it
  // is simply not carried onto a classification nobody reviewed.
  it('lets no review of another version decide this one', () => {
    const elsewhere = review({
      classification: { ...subject, latestMessageId: '10', threadId: '10' },
      verdict: corrected('suspicious', 'urgent'),
      reviewedAt: '2026-09-22T11:00:00.000Z',
    })

    expect(effectiveOutcome(unverified, [elsewhere])).toEqual({
      decidedBy: 'classifier',
      labels: { category: 'notification', priority: 'low' },
    })
  })

  it('decides nothing for a row nothing proposed labels for', () => {
    expect(effectiveOutcome({ state: 'none' }, [review()])).toEqual({ decidedBy: 'nobody' })
  })
})
