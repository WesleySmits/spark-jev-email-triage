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

/** A review of that classification, confirming it unless told otherwise. */
function review(overrides: Partial<HumanReview> = {}): HumanReview {
  return humanReviewSchema.parse({
    classification: subject,
    verdict: { decision: 'confirmed' },
    reviewer: 'wesley',
    reviewedAt: '2026-09-21T10:00:00.000Z',
    ...overrides,
  })
}

const corrected = (category: 'personal' | 'suspicious', priority: 'urgent' | 'high') => ({
  decision: 'corrected' as const,
  labels: { category, priority },
})

describe('humanReviewSchema', () => {
  it('names one classification, by the version it judged', () => {
    expect(review().classification).toEqual(subject)
  })

  it('refuses a confirmation that carries labels of its own', () => {
    const result = humanReviewSchema.safeParse({
      classification: subject,
      verdict: { decision: 'confirmed', labels: { category: 'personal', priority: 'high' } },
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

  it('refuses a correction that chooses no labels, and an unnamed reviewer', () => {
    expect(
      humanReviewSchema.safeParse({ ...review(), verdict: { decision: 'corrected' } }).success,
    ).toBe(false)
    expect(humanReviewSchema.safeParse({ ...review(), reviewer: '  ' }).success).toBe(false)
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

  it('keeps the classifier labels a person confirmed, and says who confirmed them', () => {
    expect(effectiveOutcome(unverified, [review()])).toEqual({
      decidedBy: 'reviewer',
      decision: 'confirmed',
      labels: { category: 'notification', priority: 'low' },
      reviewer: 'wesley',
      reviewedAt: '2026-09-21T10:00:00.000Z',
    })
  })

  it('prefers the latest review, whichever way round the two came', () => {
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
      decision: 'confirmed',
      labels: { category: 'notification', priority: 'low' },
      reviewedAt: '2026-09-23T09:00:00.000Z',
    })
  })

  // Two moments written in two offsets, as a caller that builds its reviews
  // rather than parsing them may still hand them over. As text the `+02:00`
  // correction reads as the later of the two, and it happened an hour before
  // the confirmation: sorting on the spelling would let it win.
  it('prefers the review that happened last, whatever offset it was written in', () => {
    const abroad: HumanReview = {
      ...review({ verdict: corrected('suspicious', 'urgent') }),
      reviewedAt: '2026-09-21T12:00:00+02:00',
    }
    const after = review({ reviewedAt: '2026-09-21T11:00:00Z' })

    expect(effectiveOutcome(unverified, [abroad, after])).toMatchObject({
      decision: 'confirmed',
      labels: { category: 'notification', priority: 'low' },
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
