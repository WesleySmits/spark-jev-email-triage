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
