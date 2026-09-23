/**
 * One review as the desk takes it, and what became of it.
 *
 * Browser-safe: this module imports no server code, so the page may hold
 * these types and build a request. The server side is `reviews.server.ts`,
 * reached only through `review.functions.ts`.
 *
 * A request names the classification reviewed and what the person decided,
 * and nothing else. Who reviewed and when are decided on the server: a
 * browser may not name a reviewer, and a review is timed by the computer
 * that stores it rather than by the clock of whatever asked.
 */
import { z } from 'zod'
import { humanReviewSchema, type ReviewRefusal } from '../domain/review'
import { categorySchema, prioritySchema } from '../domain/triage'

export const deskReviewRequestSchema = z.strictObject({
  /** The exact version the reviewer was shown, as the reading listed it. */
  classification: humanReviewSchema.shape.classification,
  verdict: humanReviewSchema.shape.verdict,
})

export type DeskReviewRequest = z.infer<typeof deskReviewRequestSchema>

/**
 * What came of one review:
 * - `recorded`: it was appended beside the classification it reviews.
 * - `refused`: the store would not take it, and says why in a content-free
 *   code. See `ReviewRefusal`; `stale_subject` is the one a person meets.
 * - `failed`: nothing was stored, and it is not a refusal: the store could
 *   not be opened or written, or the app server never answered. It names no
 *   subject, address or body, so it may be shown and logged as it is.
 */
export type DeskReviewOutcome =
  | Readonly<{ status: 'recorded' }>
  | Readonly<{ status: 'refused'; reason: ReviewRefusal }>
  | Readonly<{ status: 'failed' }>

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
