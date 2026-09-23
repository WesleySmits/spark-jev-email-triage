/**
 * One review as the desk takes it, and what became of it.
 *
 * Browser-safe: this module imports no server code, so the page may hold
 * these types and build a request. The server side is `reviews.server.ts`,
 * reached only through `review.functions.ts`.
 *
 * A request names the classification reviewed, what the person decided, and
 * one stable Save id. Who reviewed and when are decided on the server: a
 * browser may not name a reviewer, and a review is timed by the computer
 * that stores it rather than by the clock of whatever asked.
 */
import { z } from 'zod'
import { humanReviewSchema, type ReviewRefusal } from '../domain/review'
import { categorySchema, prioritySchema } from '../domain/triage'

export const deskReviewRequestSchema = z.strictObject({
  /** Stable across transport retries and page reloads for this Save. */
  requestId: z.uuid(),
  /** The exact version the reviewer was shown, as the reading listed it. */
  classification: humanReviewSchema.shape.classification,
  verdict: humanReviewSchema.shape.verdict,
})

export type DeskReviewRequest = z.infer<typeof deskReviewRequestSchema>

/**
 * What came of one review:
 * - `recorded`: it was appended beside the classification it reviews, and
 *   `review` is the original result stored for this Save id. It can be left
 *   out only if reading the committed request result failed afterwards.
 * - `refused`: the store would not take it, and says why in a content-free
 *   code. See `ReviewRefusal`; `stale_subject` is the one a person meets.
 * - `failed`: the server answered that the store could not be written.
 * - `unknown`: the answer was lost or commit could not be confirmed. Reuse
 *   the same Save id to check or retry without appending a second review.
 */
export type DeskReviewOutcome =
  | Readonly<{ status: 'recorded'; review?: RowReview | undefined }>
  | Readonly<{ status: 'refused'; reason: ReviewRefusal }>
  | Readonly<{ status: 'failed' }>
  | Readonly<{ status: 'unknown' }>

/** A read-only check of the durable result for one Save id and payload. */
export type DeskReviewReadback =
  | Readonly<{ status: 'recorded'; review: RowReview }>
  | Readonly<{ status: 'refused'; reason: ReviewRefusal }>
  | Readonly<{ status: 'absent' | 'unavailable' }>

/**
 * What a person decided about one row's classification, as the browser is
 * told it: the reviewer branch of `EffectiveOutcome`, which `effectiveOutcome`
 * projects from the classification a reading holds and the reviews stored for
 * its mailbox copy.
 *
 * Only that branch travels. The other two say the classifier decides or
 * nobody does, and the browser already holds the classification those are
 * read from, so a row nobody reviewed simply carries none of this. The labels
 * here are the ones the row shows; the classification keeps what the model
 * proposed, so both stay legible side by side.
 *
 * It is scoped exactly as the store scopes it: a review decides this only for
 * the mailbox copy and the subject version it named. A review of another copy
 * or of a version that has moved on decides nothing here and is not sent.
 */
export const rowReviewSchema = z.strictObject({
  decidedBy: z.literal('reviewer'),
  decision: z.enum(['confirmed', 'corrected']),
  labels: z.strictObject({ category: categorySchema, priority: prioritySchema }),
  /** How this computer names the reviewer. Never a mailbox address. */
  reviewer: z.string().min(1),
  /** When they reviewed, in UTC, as the store keeps it. */
  reviewedAt: z.iso.datetime(),
})

export type RowReview = Readonly<z.infer<typeof rowReviewSchema>>
