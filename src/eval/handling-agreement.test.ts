import { describe, expect, it } from 'vitest'
import type { TriageOutcome } from '../jev/policy'
import type { ReviewedExpectation } from './reviewed-set'
import { handlingAgrees } from './handling-agreement'

type Judged = Extract<TriageOutcome, { status: 'classified' }>

const threadId = 'thread-example'

const judged = (review: Judged['review']): Judged => ({
  status: 'classified',
  threadId,
  category: 'personal',
  priority: 'high',
  priorityUncertain: false,
  confidence: 0.9,
  review,
  reviewPriority: 'normal',
  reasons: review === 'needs_review' ? ['low_category_confidence'] : [],
  replyExpected: 'likely',
  deadline: 'unlikely',
  suspicionSignals: [],
})

const providerFailure: TriageOutcome = {
  status: 'unclassified',
  threadId,
  review: 'needs_review',
  reviewPriority: 'normal',
  reasons: ['provider_failure'],
}

const expecting = (handling: ReviewedExpectation['handling']): ReviewedExpectation => ({
  category: 'personal',
  priority: 'high',
  handling,
  rationale: 'Only the handling matters here.',
})

describe('handlingAgrees', () => {
  it('agrees when the labels are accepted and the set asked for no person', () => {
    expect(handlingAgrees(expecting('may_auto_label'), judged('auto_accepted'))).toBe(true)
  })

  it('agrees when the thread goes to review and the set asked for a person', () => {
    expect(handlingAgrees(expecting('needs_person'), judged('needs_review'))).toBe(true)
  })

  it('disagrees when the labels are accepted but the set asked for a person', () => {
    expect(handlingAgrees(expecting('needs_person'), judged('auto_accepted'))).toBe(false)
  })

  it('disagrees when the thread goes to review but the set asked for no person', () => {
    expect(handlingAgrees(expecting('may_auto_label'), judged('needs_review'))).toBe(false)
  })

  // Policy reports `needs_review` after a provider failure because nothing
  // judged the thread. That is not a decision to compare an expectation with.
  it('has nothing to compare after a provider failure, whatever the set expects', () => {
    expect(handlingAgrees(expecting('needs_person'), providerFailure)).toBeNull()
    expect(handlingAgrees(expecting('may_auto_label'), providerFailure)).toBeNull()
  })
})
