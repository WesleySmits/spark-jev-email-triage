import { describe, expect, it } from 'vitest'
import { admitReview, effectiveOutcome, humanReviewSchema } from '../../../domain/review'
import type {
  ClassificationLabels,
  StoredClassification,
} from '../../../domain/stored-classification'
import { classificationView, rowState, type ClassificationFact } from './classification'
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

type Currency = (typeof currency)[number]
type Decision = 'none' | 'confirmed' | 'corrected'
type Fields = readonly [priorityUncertain: boolean, reviewPriority: 'normal' | 'elevated']

const fields: readonly Fields[] = [
  [false, 'normal'],
  [true, 'normal'],
  [false, 'elevated'],
  [true, 'elevated'],
]

/**
 * One judgment with two independent grounds: a score about the category, and a
 * signal about what the mail asks for. Only the first is what a category review
 * could answer, so the second is what has to survive one.
 */
const labelsWith = ([priorityUncertain, reviewPriority]: Fields): ClassificationLabels =>
  Object.freeze({
    category: 'personal',
    priority: 'high',
    confidence: 0.58,
    priorityUncertain,
    reviewPriority,
    review: 'needs_review',
    grounds: {
      state: 'recorded',
      reasons: ['low_category_confidence', 'suspicious'],
      suspicionSignals: ['credential_request'],
    } as const,
  })

/**
 * That judgment, the review a person saved of it, and what the reader shows
 * once the domain has projected the two together. The real category request and
 * projection are used, including reviews saved before a classification went
 * stale, so what is asserted is the route the page takes. Nothing calls a
 * store, a classifier or a mailbox.
 */
function reviewed(state: Currency, decision: Decision, values: Fields) {
  const labels = labelsWith(values)
  const classification: StoredClassification = Object.freeze({
    ...state,
    subject,
    labels,
    judgedAt: '2026-09-22T09:15:00.000Z',
  })
  const chosen = decision === 'corrected' ? 'notification' : 'personal'
  const review = humanReviewSchema.parse({
    ...reviewRequest({ subject, labels }, chosen),
    reviewer: 'fixture-reviewer',
    reviewedAt: '2026-09-22T10:00:00.000Z',
  })
  const outcome = effectiveOutcome(classification, decision === 'none' ? [] : [review])
  const projected = outcome.decidedBy === 'reviewer' ? outcome : undefined
  return {
    classification,
    review,
    projected,
    shown: classificationView(classification, projected),
  }
}

const factNamed = (facts: readonly ClassificationFact[], term: string) =>
  facts.find((fact) => fact.term === term)

describe.each(currency)('category review of $state ($reason)', (state) => {
  describe.each(['none', 'confirmed', 'corrected'] as const)('%s', (decision) => {
    it.each(fields)(
      'preserves priority uncertainty %s and review priority %s',
      (priorityUncertain, reviewPriority) => {
        const { classification, shown, review, projected } = reviewed(state, decision, [
          priorityUncertain,
          reviewPriority,
        ])
        const before = structuredClone(classification)

        expect(shown.facts[0]?.value).toBe(decision === 'corrected' ? 'Notification' : 'Personal')
        expect(shown.facts[1]).toEqual({
          term: 'Priority',
          value: 'High',
          ...(priorityUncertain && { note: 'The model was not sure of this priority.' }),
        })
        expect(shown.facts[2]?.note?.includes('Marked as more urgent to look at.')).toBe(
          reviewPriority === 'elevated',
        )
        expect(shown.facts[2]).toMatchObject({
          term: decision === 'none' ? 'Review' : 'Category review',
        })
        expect(shown.state).toEqual(classificationView(classification).state)
        expect(shown.detail).toBe(classificationView(classification).detail)
        expect(rowState(classification, projected).status).toEqual(shown.state)
        expect(classification).toEqual(before)
        expect(admitReview(review, classification).status).toBe(
          state.state === 'stale' ? 'refused' : 'admitted',
        )
        expect(reviewableIn(classification) === undefined).toBe(state.state === 'stale')
      },
    )

    it.each(fields)(
      'keeps the independent warning with priority uncertainty %s and review priority %s',
      (priorityUncertain, reviewPriority) => {
        // What a mail asked for does not change because someone filed it
        // elsewhere, so a category review clears no warning: the reader says so
        // in the same words whether or not anyone reviewed.
        const { shown } = reviewed(state, decision, [priorityUncertain, reviewPriority])

        expect(factNamed(shown.facts, 'Warning')).toEqual({
          term: 'Warning',
          value: 'Possible scam or phishing',
          note: 'It may ask for a password, a login code or another credential. Each is a possibility the model scored, not a checked finding. This stands whatever category a person decides on.',
        })
        expect(factNamed(shown.facts, 'Why review')?.value).toBe(
          'Low category score · Possible scam or phishing',
        )
      },
    )
  })
})
