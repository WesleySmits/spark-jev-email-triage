/**
 * Records one person's review of one stored classification.
 *
 * The only write the application makes, and it touches no mailbox: no Spark
 * command runs here and no classifier is asked. A review is a decision about
 * a row this computer already holds, appended beside the judgment it
 * reviews, which stays exactly as a run stored it.
 *
 * Whether the review may be stored at all is the domain's call, made inside
 * the write transaction by `recordReview` over the classification the store
 * holds at that moment. So a shadow run that observed a newer message since
 * the page listed it cannot have the review land on a version its reviewer
 * never read: the write is refused as stale instead.
 *
 * Who reviewed and when are decided here rather than sent by a browser. The
 * reviewer is this computer's account name, never a mailbox address, and the
 * time is this computer's clock. A recorded review is answered with what a
 * reading of the store would now project for that row, so the page can show
 * it at once without listing anything again and without making up a reviewer
 * or a time of its own. Nothing that fails here says more than a coarse
 * status: no subject, address or body leaves this module.
 */
import { existsSync } from 'node:fs'
import { userInfo } from 'node:os'
import type { DatabaseSync } from 'node:sqlite'
import { humanReviewSchema } from '../domain/review'
import { currentTriageRubric } from '../domain/triage'
import { jevModel } from '../jev/questions'
import { readDatabasePath } from '../shadow/config'
import { openForWriting } from '../shadow/database'
import { recordReview } from '../shadow/reviews'
import type { DeskReviewOutcome, DeskReviewRequest } from './desk-review'
import { storedReviewFor } from './stored-classifications.server'

/** The versions a stored judgment must name to still be the one reviewed. */
const currentJudge = { rubric: currentTriageRubric, classifierVersion: jevModel }

const failed: DeskReviewOutcome = { status: 'failed' }

type Env = Readonly<Record<string, string | undefined>>

/**
 * Who reviewed, as this computer names them. It is an account name on this
 * machine, never a mailbox address, and never anything a request supplied.
 */
export function localReviewer(): string {
  try {
    const name = userInfo().username.trim()
    return name === '' ? 'local' : name
  } catch {
    // Some accounts have no readable entry. A review still has a reviewer.
    return 'local'
  }
}

/** The database, or `null` when it cannot be opened for writing at all. */
function opened(path: string): DatabaseSync | null {
  try {
    return openForWriting(path)
  } catch {
    return null
  }
}

/**
 * Appends one review, or says why nothing was stored. A store no run has
 * ever written holds no classification to review, so the review is refused
 * as `unclassified` rather than creating a database to put it in.
 */
export function storeReview(
  request: DeskReviewRequest,
  env: Env = process.env,
  now: () => Date = () => new Date(),
): DeskReviewOutcome {
  const path = readDatabasePath(env)
  if (!existsSync(path)) return { status: 'refused', reason: 'unclassified' }
  const db = opened(path)
  if (db === null) return failed
  try {
    const review = humanReviewSchema.parse({
      ...request,
      reviewer: localReviewer(),
      reviewedAt: now().toISOString(),
    })
    const recorded = recordReview(db, review, currentJudge)
    if (recorded.status !== 'recorded') return recorded
    // Read back rather than assembled from what was just written: a
    // confirmation carries no labels of its own, and the row may have been
    // judged again in between, so only the store can say what it now shows.
    return { status: 'recorded', review: storedReviewFor(db, request.classification.copy) }
  } catch {
    // A write that did not go through is never reported as one that did.
    return failed
  } finally {
    db.close()
  }
}
