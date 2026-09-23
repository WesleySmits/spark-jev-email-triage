/**
 * Whether policy handled a thread the way the candidate set expects.
 *
 * The two vocabularies differ on purpose, and a report that prints them side
 * by side asks its reader to guess how they line up. A candidate expectation
 * says what should happen to the mail: `needs_person`, or `may_auto_label`.
 * A policy outcome says what became of the labels: `needs_review`, or
 * `auto_accepted`, which means the classifier accepted its own labels and
 * never that a person did. They are the same axis, so the mapping is written
 * down here instead of being left to a reader of a table.
 *
 * Only the set knows the expectation and only policy knows the outcome, so
 * this belongs in neither: `candidate-set.ts` stays free of the code it
 * measures, and policy stays unaware of being measured. Nothing here changes
 * a judgment; it only compares two that were made already.
 */
import type { TriageOutcome } from '../jev/policy'
import type { CandidateExpectation } from './candidate-set'

type Handling = CandidateExpectation['handling']
type Judged = Extract<TriageOutcome, { status: 'classified' }>

/** The review each handling predicts. */
const predictedReview = {
  may_auto_label: 'auto_accepted',
  needs_person: 'needs_review',
} as const satisfies Record<Handling, Judged['review']>

/**
 * `true` or `false` once a thread has been judged, and `null` when there is
 * nothing to compare. A provider failure is not a judgment: policy reports
 * `needs_review` because no one judged the thread, not because it decided a
 * person should see it. Counting that as agreement would flatter the set,
 * and counting it as a mismatch would blame it for an outage, so it belongs
 * in neither figure.
 */
export const handlingAgrees = (
  expectation: CandidateExpectation,
  outcome: TriageOutcome,
): boolean | null =>
  outcome.status === 'classified' ? outcome.review === predictedReview[expectation.handling] : null
