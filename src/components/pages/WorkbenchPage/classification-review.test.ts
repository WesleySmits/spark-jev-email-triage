import { describe, expect, it } from 'vitest'
import { admitReview, effectiveOutcome, humanReviewSchema } from '../../../domain/review'
import type {
  ClassificationLabels,
  StoredClassification,
} from '../../../domain/stored-classification'
import { classificationView, rowState } from './classification'
import { reviewRequest, reviewableIn } from './review'

const subject = {
  copy: { mailboxId: 'one@mail.example', messageId: '11' },
  threadId: 't-11',
  latestMessageId: '11',
  rubric: 'email-triage.v2',
  classifierVersion: 'jev-1.13.0',
} as const

const currency = [
  { state: 'current' },
  { state: 'unverified' },
  { state: 'stale', reason: 'newer_message' },
  { state: 'stale', reason: 'other_snapshot' },
  { state: 'stale', reason: 'rubric' },
  { state: 'stale', reason: 'classifier' },
] as const

// Exercise the real category request and domain projection together, including
// reviews saved before a classification went stale. No store or provider calls.
describe.each(currency)('category review of $state ($reason)', (state) => {
  describe.each(['none', 'confirmed', 'corrected'] as const)('%s', (decision) => {
    it.each([
      [false, 'normal'],
      [true, 'normal'],
      [false, 'elevated'],
      [true, 'elevated'],
    ] as const)(
      'preserves priority uncertainty %s and review priority %s',
      (priorityUncertain, reviewPriority) => {
        const labels: ClassificationLabels = Object.freeze({
          category: 'personal',
          priority: 'high',
          confidence: 0.58,
          priorityUncertain,
          reviewPriority,
          review: 'needs_review',
        })
        const classification: StoredClassification = Object.freeze({
          ...state,
          subject,
          labels,
          judgedAt: '2026-09-22T09:15:00.000Z',
        })
        const before = structuredClone(classification)
        const chosen = decision === 'corrected' ? 'notification' : 'personal'
        const review = humanReviewSchema.parse({
          ...reviewRequest({ subject, labels }, chosen),
          reviewer: 'fixture-reviewer',
          reviewedAt: '2026-09-22T10:00:00.000Z',
        })
        const outcome = effectiveOutcome(classification, decision === 'none' ? [] : [review])
        const projected = outcome.decidedBy === 'reviewer' ? outcome : undefined
        const shown = classificationView(classification, projected)

        expect(shown.facts[0]?.value).toBe(decision === 'corrected' ? 'Notification' : 'Personal')
        expect(shown.facts[1]).toEqual({
          term: 'Priority',
          value: 'High',
          ...(priorityUncertain && { note: 'The model was not sure of this priority.' }),
        })
        expect(shown.facts[2]?.note?.includes('Marked as more urgent to look at.')).toBe(
          reviewPriority === 'elevated',
        )
        expect(shown.state).toEqual(classificationView(classification).state)
        expect(shown.detail).toBe(classificationView(classification).detail)
        expect(rowState(classification, projected).status).toEqual(shown.state)
        expect(classification).toEqual(before)
        expect(shown.facts[2]).toMatchObject({
          term: decision === 'none' ? 'Review' : 'Category review',
        })
        expect(admitReview(review, classification).status).toBe(
          state.state === 'stale' ? 'refused' : 'admitted',
        )
        expect(reviewableIn(classification) === undefined).toBe(state.state === 'stale')
      },
    )
  })
})
