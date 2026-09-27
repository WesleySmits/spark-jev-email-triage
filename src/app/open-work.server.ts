/**
 * Records one work decision about one mailbox copy, and reads back the whole
 * recorded work list.
 *
 * It touches no mailbox: no Spark command runs here, nothing is read back
 * from Spark and no classifier is asked. "Handled in Spark" is stored as a
 * person's claim and nothing more.
 *
 * Who decided and when are stamped here rather than sent by a browser, as a
 * review is: the decider is this computer's account name, never a mailbox
 * address, and the time is this computer's clock. Whether a decision may be
 * stored at all is the domain's call, made inside the write transaction by
 * `recordFollowUp`. Nothing that fails here says more than a coarse status.
 */
import { existsSync } from 'node:fs'
import type { DatabaseSync } from 'node:sqlite'
import { decideFollowUp, type FollowUpDecision } from '../domain/follow-up'
import { readDatabasePath } from '../shadow/config'
import { openForWriting, openReadOnly } from '../shadow/database'
import { readDecidedCopies, recordFollowUp } from '../shadow/follow-ups'
import type { RecordedWork, WorkDecisionOutcome, WorkDecisionRequest } from './open-work'
import { localReviewer } from './reviews.server'

type Env = Readonly<Record<string, string | undefined>>

const failed: WorkDecisionOutcome = { status: 'failed' }

/** The decision as the store takes it, or `null` where the request cannot be one. */
function decisionOf(request: WorkDecisionRequest, now: () => Date): FollowUpDecision | null {
  try {
    return decideFollowUp({
      target: request.target,
      kind: request.kind,
      dueAt: request.dueAt,
      decidedBy: localReviewer(),
      decidedAt: now().toISOString(),
    })
  } catch {
    // A due date on a kind that takes none, for instance. Nothing is stored.
    return null
  }
}

/**
 * Appends one decision, or says why nothing was stored.
 *
 * A store that does not exist, or holds a schema this build does not hold
 * exactly, is refused rather than created or migrated: migrating belongs to
 * `pnpm shadow --migrate`, never to one person's decision. Once the write
 * commits the outcome is `recorded`; a failure during the
 * transaction may have committed, so it is `unknown` and the same Save id
 * may be sent again without recording a second decision.
 */
export function storeWorkDecision(
  request: WorkDecisionRequest,
  env: Env = process.env,
  now: () => Date = () => new Date(),
): WorkDecisionOutcome {
  const decision = decisionOf(request, now)
  const path = readDatabasePath(env)
  if (decision === null || !existsSync(path)) return failed
  let db: DatabaseSync
  try {
    db = openForWriting(path)
  } catch {
    return failed
  }
  try {
    return recordFollowUp(db, decision, request.requestId)
  } catch {
    return { status: 'unknown' }
  } finally {
    db.close()
  }
}

/**
 * Every copy anybody decided about, read without writing. A store that does
 * not exist yet holds no decision, which is `absent` rather than an error;
 * a store that cannot be read is `unavailable`, never an empty list.
 */
export function readRecordedWork(
  env: Env = process.env,
  now: () => Date = () => new Date(),
): RecordedWork {
  const path = readDatabasePath(env)
  if (!existsSync(path)) return { status: 'absent' }
  try {
    const db = openReadOnly(path)
    try {
      const { copies, bounded } = readDecidedCopies(db)
      return { status: 'ready', copies, bounded, readAt: now().toISOString() }
    } finally {
      db.close()
    }
  } catch {
    return { status: 'unavailable' }
  }
}
