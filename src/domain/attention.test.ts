import { describe, expect, it } from 'vitest'
import {
  attentionOf,
  attentionRank,
  attentionStates,
  tallyAttention,
  tallyReachOf,
  type Attention,
  type AttentionReview,
} from './attention'
import type { ClassificationLabels, StoredClassification } from './stored-classification'

// Fictional judgments, shaped as the domain states them. Which judgment a
// row holds is decided in `stored-classification.test.ts`; this file covers
// only what kind of attention a held judgment asks for.
const accepted: ClassificationLabels = {
  category: 'personal',
  priority: 'normal',
  confidence: 0.91,
  priorityUncertain: false,
  review: 'auto_accepted',
  reviewPriority: 'normal',
  grounds: { state: 'recorded', reasons: [], suspicionSignals: [] },
}

const askedForAPerson: ClassificationLabels = {
  ...accepted,
  category: 'other',
  confidence: 0.42,
  review: 'needs_review',
  grounds: { state: 'recorded', reasons: ['ambiguous_category'], suspicionSignals: [] },
}

const subject = {
  copy: { mailboxId: 'one@mail.example', messageId: '11' },
  threadId: 't-11',
  latestMessageId: '11',
  rubric: 'email-triage.v2',
  classifierVersion: 'jev-1.13.0',
} as const

const judged = { subject, judgedAt: '2026-09-22T09:15:00.000Z' } as const

const unverified = (labels: ClassificationLabels): StoredClassification => ({
  ...judged,
  state: 'unverified',
  labels,
})

const current = (labels: ClassificationLabels): StoredClassification => ({
  ...judged,
  state: 'current',
  labels,
})

const withLabels = (change: Partial<ClassificationLabels>): ClassificationLabels => ({
  ...accepted,
  ...change,
})

const correctedTo = (labels: AttentionReview['labels']): AttentionReview => ({
  decision: 'corrected',
  labels,
})

describe('attentionOf', () => {
  it('places a held judgment by the priority the model gave it', () => {
    expect(attentionOf(unverified(withLabels({ priority: 'urgent' })))).toMatchObject({
      state: 'high_priority',
      decidedBy: 'classifier',
      evidence: 'unverified',
    })
    expect(attentionOf(current(withLabels({ priority: 'high' })))).toMatchObject({
      state: 'high_priority',
      evidence: 'current',
    })
    expect(attentionOf(unverified(accepted))).toMatchObject({ state: 'attention' })
    expect(attentionOf(unverified(withLabels({ priority: 'low' })))).toMatchObject({
      state: 'informational',
    })
  })

  it('keeps the model labels as both the labels and the advice where nobody reviewed', () => {
    expect(attentionOf(unverified(accepted))).toEqual({
      state: 'attention',
      labels: { category: 'personal', priority: 'normal' },
      decidedBy: 'classifier',
      advice: { category: 'personal', priority: 'normal' },
      evidence: 'unverified',
    })
  })

  it('files newsletters and promotions as informational whatever their priority', () => {
    expect(
      attentionOf(unverified(withLabels({ category: 'newsletter', priority: 'urgent' }))),
    ).toMatchObject({ state: 'informational' })
    expect(
      attentionOf(unverified(withLabels({ category: 'promotion', priority: 'high' }))),
    ).toMatchObject({ state: 'informational' })
  })

  it('does not let a category alone make a notification or purchase informational', () => {
    expect(
      attentionOf(unverified(withLabels({ category: 'notification', priority: 'high' }))),
    ).toMatchObject({ state: 'high_priority' })
    expect(
      attentionOf(unverified(withLabels({ category: 'purchase', priority: 'normal' }))),
    ).toMatchObject({ state: 'attention' })
  })

  it('asks for a person before it trusts any label the policy questioned', () => {
    // An urgent label nobody trusts places nothing: the review comes first.
    const questioned = withLabels({
      ...askedForAPerson,
      priority: 'urgent',
      reviewPriority: 'elevated',
    })
    expect(attentionOf(unverified(questioned))).toMatchObject({
      state: 'needs_review',
      labels: { category: 'other', priority: 'urgent' },
      decidedBy: 'classifier',
    })
    expect(attentionOf(current(askedForAPerson))).toMatchObject({ state: 'needs_review' })
  })

  it('lets a confirmation settle a judgment that asked for a person', () => {
    const confirmed: AttentionReview = {
      decision: 'confirmed',
      labels: { category: 'other', priority: 'normal' },
    }
    expect(attentionOf(unverified(askedForAPerson), confirmed)).toEqual({
      state: 'attention',
      labels: { category: 'other', priority: 'normal' },
      decidedBy: 'reviewer',
      advice: { category: 'other', priority: 'normal' },
      evidence: 'unverified',
    })
  })

  it('places a row by what a person chose and keeps the model advice beside it', () => {
    const pressing = unverified(withLabels({ category: 'personal', priority: 'urgent' }))
    const filed = attentionOf(pressing, correctedTo({ category: 'promotion', priority: 'urgent' }))
    expect(filed).toEqual({
      state: 'informational',
      labels: { category: 'promotion', priority: 'urgent' },
      decidedBy: 'reviewer',
      advice: { category: 'personal', priority: 'urgent' },
      evidence: 'unverified',
    })
    // A person raising a mail the model filed as low is equally decisive.
    const quiet = unverified(withLabels({ category: 'notification', priority: 'low' }))
    expect(
      attentionOf(quiet, correctedTo({ category: 'personal', priority: 'high' })),
    ).toMatchObject({ state: 'high_priority', decidedBy: 'reviewer' })
  })

  it('never places a row by a judgment that no longer holds, and names why', () => {
    const stale: StoredClassification = {
      ...judged,
      state: 'stale',
      reason: 'newer_message',
      labels: withLabels({ priority: 'urgent' }),
    }
    expect(attentionOf(stale)).toEqual({ state: 'unclassified', cause: 'stale' })
    expect(attentionOf({ ...judged, state: 'provider_failure', errorCode: 'timeout' })).toEqual({
      state: 'unclassified',
      cause: 'provider_failure',
    })
    expect(attentionOf({ state: 'unavailable', reason: 'unreadable' })).toEqual({
      state: 'unclassified',
      cause: 'unavailable',
    })
    expect(attentionOf({ state: 'none' })).toEqual({ state: 'unclassified', cause: 'none' })
    expect(attentionOf(undefined)).toEqual({ state: 'unclassified', cause: 'none' })
  })

  it('ignores a review passed beside a judgment that no longer holds', () => {
    // The page never passes one, and even if it did, an old version's review
    // cannot make the row reliable again.
    const stale: StoredClassification = {
      ...judged,
      state: 'stale',
      reason: 'rubric',
      labels: accepted,
    }
    expect(attentionOf(stale, correctedTo({ category: 'personal', priority: 'urgent' }))).toEqual({
      state: 'unclassified',
      cause: 'stale',
    })
  })
})

describe('attentionRank', () => {
  it('orders review first, then pressing, ordinary, unjudged and informational', () => {
    const ranked = [...attentionStates].sort((a, b) => attentionRank(b) - attentionRank(a))
    expect(ranked).toEqual([
      'informational',
      'unclassified',
      'attention',
      'high_priority',
      'needs_review',
    ])
    expect(attentionRank('needs_review')).toBe(0)
  })
})

describe('tallyReachOf', () => {
  it('counts a proven scope only for a complete, unbounded, fully read reading', () => {
    expect(tallyReachOf({ bounded: false, failed: [] })).toBe('proven')
    expect(tallyReachOf({ bounded: false, failed: [], incomplete: [] })).toBe('proven')
  })

  it('counts only what was loaded once anything may be missing', () => {
    expect(tallyReachOf({ bounded: true, failed: [] })).toBe('loaded')
    expect(tallyReachOf({ bounded: false, failed: [{ id: 'one' }] })).toBe('loaded')
    expect(tallyReachOf({ bounded: false, failed: [], incomplete: [{ id: 'one' }] })).toBe('loaded')
  })
})

describe('tallyAttention', () => {
  const rows: readonly Attention[] = [
    attentionOf(unverified(withLabels({ priority: 'urgent' }))),
    attentionOf(unverified(askedForAPerson)),
    attentionOf(unverified(accepted)),
    attentionOf(unverified(withLabels({ category: 'newsletter' }))),
    attentionOf({ state: 'none' }),
    attentionOf(unverified(withLabels({ priority: 'high' }))),
  ]

  it('counts every state, at zero where none, and sums to the rows given', () => {
    const tally = tallyAttention(rows, { bounded: false, failed: [] })
    expect(tally).toEqual({
      counts: {
        needs_review: 1,
        high_priority: 2,
        attention: 1,
        unclassified: 1,
        informational: 1,
      },
      total: 6,
      reach: 'proven',
    })
    expect(tallyAttention([], { bounded: false, failed: [] })).toEqual({
      counts: {
        needs_review: 0,
        high_priority: 0,
        attention: 0,
        unclassified: 0,
        informational: 0,
      },
      total: 0,
      reach: 'proven',
    })
  })

  it('says a bounded or partly failed reading counted only what was loaded', () => {
    expect(tallyAttention(rows, { bounded: true, failed: [] }).reach).toBe('loaded')
    expect(tallyAttention(rows, { bounded: false, failed: ['two@mail.example'] }).reach).toBe(
      'loaded',
    )
  })
})
