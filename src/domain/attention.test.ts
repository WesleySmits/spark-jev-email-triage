import { describe, expect, it } from 'vitest'
import {
  attentionOf,
  attentionRank,
  attentionStates,
  tallyAttention,
  type Attention,
} from './attention'
import type { ClassificationLabels, StoredClassification } from './stored-classification'
import { currentTriageRubric } from './triage'

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

const possibleScam: ClassificationLabels = {
  ...askedForAPerson,
  priority: 'low',
  reviewPriority: 'elevated',
  grounds: {
    state: 'recorded',
    reasons: ['ambiguous_category', 'suspicious'],
    suspicionSignals: ['credential_request'],
  },
}

const judged = {
  subject: {
    copy: { mailboxId: 'one@mail.example', messageId: '11' },
    threadId: 't-11',
    latestMessageId: '11',
    rubric: currentTriageRubric,
    classifierVersion: 'jev-1.13.0',
  },
  judgedAt: '2026-09-22T09:15:00.000Z',
} as const

const unverified = (change: Partial<ClassificationLabels> = {}): StoredClassification => ({
  ...judged,
  state: 'unverified',
  labels: { ...accepted, ...change },
})

const complete = { result: 'complete' } as const
const incomplete = { result: 'incomplete' } as const

describe('attentionOf', () => {
  it('places a held judgment by the priority the model gave it', () => {
    expect(attentionOf(unverified({ priority: 'urgent' }))).toMatchObject({
      state: 'high_priority',
      categoryBy: 'classifier',
      evidence: 'unverified',
    })
    const current: StoredClassification = {
      ...judged,
      state: 'current',
      labels: { ...accepted, priority: 'high' },
    }
    expect(attentionOf(current)).toMatchObject({ state: 'high_priority', evidence: 'current' })
    expect(attentionOf(unverified())).toMatchObject({ state: 'attention' })
    expect(attentionOf(unverified({ priority: 'low' }))).toMatchObject({ state: 'informational' })
  })

  it('carries the model labels as advice and every signal the record holds', () => {
    expect(attentionOf(unverified({ priorityUncertain: true }))).toEqual({
      state: 'attention',
      category: 'personal',
      categoryBy: 'classifier',
      priority: 'normal',
      priorityBy: 'classifier',
      priorityUncertain: true,
      advice: { category: 'personal', priority: 'normal' },
      warning: false,
      elevated: false,
      evidence: 'unverified',
    })
  })

  it('files the rubric’s informational categories as information at any priority', () => {
    expect(attentionOf(unverified({ category: 'newsletter', priority: 'urgent' }))).toMatchObject({
      state: 'informational',
    })
    expect(attentionOf(unverified({ category: 'promotion', priority: 'high' }))).toMatchObject({
      state: 'informational',
    })
  })

  it('lets priority decide for notifications and purchases', () => {
    expect(attentionOf(unverified({ category: 'notification', priority: 'high' }))).toMatchObject({
      state: 'high_priority',
    })
    expect(attentionOf(unverified({ category: 'purchase', priority: 'normal' }))).toMatchObject({
      state: 'attention',
    })
    expect(attentionOf(unverified({ category: 'notification', priority: 'low' }))).toMatchObject({
      state: 'informational',
    })
  })

  it('treats suspicious mail as pressing, however low the model set its priority', () => {
    expect(attentionOf(unverified({ category: 'suspicious', priority: 'low' }))).toMatchObject({
      state: 'high_priority',
    })
  })

  it('asks for a person before it trusts any label the policy questioned', () => {
    // An urgent label nobody trusts places nothing: the review comes first.
    expect(attentionOf(unverified({ ...askedForAPerson, priority: 'urgent' }))).toMatchObject({
      state: 'needs_review',
      category: 'other',
      priority: 'urgent',
      categoryBy: 'classifier',
    })
    expect(attentionOf(unverified(possibleScam))).toMatchObject({
      state: 'needs_review',
      warning: true,
      elevated: true,
    })
  })

  it('lets a decision about the category settle a judgment that asked for a person', () => {
    expect(
      attentionOf(unverified(askedForAPerson), { labels: { category: 'other' } }),
    ).toMatchObject({
      state: 'attention',
      category: 'other',
      categoryBy: 'reviewer',
      priorityBy: 'classifier',
      advice: { category: 'other', priority: 'normal' },
    })
    expect(
      attentionOf(unverified(askedForAPerson), {
        labels: { category: 'personal', priority: 'high' },
      }),
    ).toMatchObject({ state: 'high_priority', categoryBy: 'reviewer', priorityBy: 'reviewer' })
  })

  it('keeps asking for a person about the category when only the priority was decided', () => {
    // Every ground policy records is about the category, so a priority
    // decision leaves the question open. The decided priority is still the
    // person's, and places nothing until the category is decided.
    for (const questioned of [askedForAPerson, possibleScam]) {
      expect(attentionOf(unverified(questioned), { labels: { priority: 'high' } })).toMatchObject({
        state: 'needs_review',
        categoryBy: 'classifier',
        priority: 'high',
        priorityBy: 'reviewer',
      })
    }
  })

  it('places a row by the category a person chose and keeps the advice beside it', () => {
    const pressing = unverified({ category: 'personal', priority: 'urgent' })
    expect(attentionOf(pressing, { labels: { category: 'promotion' } })).toMatchObject({
      state: 'informational',
      category: 'promotion',
      categoryBy: 'reviewer',
      priority: 'urgent',
      priorityBy: 'classifier',
      advice: { category: 'personal', priority: 'urgent' },
    })
  })

  it('places a row by the priority a person chose', () => {
    const quiet = unverified({ category: 'notification', priority: 'low' })
    expect(attentionOf(quiet, { labels: { priority: 'urgent' } })).toMatchObject({
      state: 'high_priority',
      priority: 'urgent',
      priorityBy: 'reviewer',
    })
    const pressing = unverified({ category: 'personal', priority: 'urgent' })
    expect(attentionOf(pressing, { labels: { priority: 'low' } })).toMatchObject({
      state: 'informational',
      priorityBy: 'reviewer',
    })
  })

  it('never lets the model’s low priority bury a row a person re-filed', () => {
    // The model gave its priority to its own category. A person who chose
    // another category decided nothing about that priority, so it can still
    // raise the row but cannot file it as information.
    const quiet = unverified({ category: 'notification', priority: 'low' })
    expect(attentionOf(quiet, { labels: { category: 'personal' } })).toMatchObject({
      state: 'attention',
      categoryBy: 'reviewer',
      priority: 'low',
      priorityBy: 'classifier',
    })
    const pressing = unverified({ category: 'notification', priority: 'high' })
    expect(attentionOf(pressing, { labels: { category: 'personal' } })).toMatchObject({
      state: 'high_priority',
    })
    // Confirming the category keeps the model's low priority trusted for it,
    // and a person's own low priority is trusted for any category.
    expect(attentionOf(quiet, { labels: { category: 'notification' } })).toMatchObject({
      state: 'informational',
      categoryBy: 'reviewer',
    })
    expect(attentionOf(quiet, { labels: { category: 'personal', priority: 'low' } })).toMatchObject(
      { state: 'informational', priorityBy: 'reviewer' },
    )
  })

  it('keeps a possible scam out of information whatever a person decides', () => {
    const promoted = attentionOf(unverified(possibleScam), { labels: { category: 'promotion' } })
    expect(promoted).toMatchObject({ state: 'attention', warning: true })
    const confirmed = attentionOf(unverified(possibleScam), { labels: { category: 'other' } })
    expect(confirmed).toMatchObject({ state: 'attention', warning: true, elevated: true })
    const lowered = attentionOf(unverified(possibleScam), {
      labels: { category: 'other', priority: 'low' },
    })
    expect(lowered).toMatchObject({ state: 'attention', warning: true })
    const refiled = attentionOf(unverified(possibleScam), { labels: { category: 'suspicious' } })
    expect(refiled).toMatchObject({ state: 'high_priority', warning: true })
  })

  it('claims no warning where the record names no grounds', () => {
    expect(attentionOf(unverified({ grounds: { state: 'unknown' } }))).toMatchObject({
      warning: false,
    })
  })

  it('never places a row by a judgment that no longer holds, and names why', () => {
    const stale: StoredClassification = {
      ...judged,
      state: 'stale',
      reason: 'newer_message',
      labels: { ...accepted, priority: 'urgent' },
    }
    expect(attentionOf(stale)).toEqual({ state: 'unclassified', cause: 'stale' })
    // An old version's review cannot make the row reliable again.
    expect(attentionOf(stale, { labels: { priority: 'urgent' } })).toEqual({
      state: 'unclassified',
      cause: 'stale',
    })
    expect(attentionOf({ ...judged, state: 'provider_failure', errorCode: 'timeout' })).toEqual({
      state: 'unclassified',
      cause: 'provider_failure',
    })
    expect(attentionOf({ state: 'unavailable', reason: 'unreadable' })).toEqual({
      state: 'unclassified',
      cause: 'unavailable',
    })
    expect(attentionOf({ state: 'none' })).toEqual({ state: 'unclassified', cause: 'none' })
  })
})

describe('attentionRank', () => {
  it('orders review first, then pressing, ordinary, unjudged and informational', () => {
    expect(attentionStates.map(attentionRank)).toEqual([0, 1, 2, 3, 4])
    expect(attentionRank('needs_review')).toBeLessThan(attentionRank('high_priority'))
    expect(attentionRank('unclassified')).toBeLessThan(attentionRank('informational'))
  })
})

describe('tallyAttention', () => {
  const rows: readonly Attention[] = [
    attentionOf(unverified({ priority: 'urgent' })),
    attentionOf(unverified(askedForAPerson)),
    attentionOf(unverified()),
    attentionOf(unverified({ category: 'newsletter' })),
    attentionOf({ state: 'none' }),
    attentionOf(unverified({ priority: 'high' })),
  ]

  const counts = {
    needs_review: 1,
    high_priority: 2,
    attention: 1,
    unclassified: 1,
    informational: 1,
  }

  it('counts every state, at zero where none, and sums to the rows given', () => {
    expect(tallyAttention(rows, complete)).toEqual({ counts, total: 6, reach: 'proven' })
    expect(tallyAttention([], complete)).toEqual({
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

  it('counts only what was loaded unless the reading was proved complete', () => {
    expect(tallyAttention(rows, incomplete)).toEqual({ counts, total: 6, reach: 'loaded' })
    expect(tallyAttention(rows, { result: 'failed' })).toMatchObject({ reach: 'loaded' })
  })
})
