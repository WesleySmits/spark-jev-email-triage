/**
 * Stores human reviews of stored classifications, and reads them back.
 *
 * A review is appended, never merged: `judgments` is not touched, so what
 * the classifier proposed survives every confirmation and correction of it,
 * and both of those survive each other. The database enforces that as well
 * as this module does — `reviews` carries triggers that refuse an update or
 * a delete — so a later writer cannot quietly rewrite what a person said.
 *
 * Whether a review may be stored at all is decided in the domain, by
 * `admitReview`, over the classification `projectClassification` reads for
 * the copy at that moment. Reading and admitting happen inside the write
 * transaction, so a shadow run that observes a newer message between the two
 * cannot slip a review onto a version its reviewer never read.
 *
 * Nothing here reads a mailbox. Reviewing runs no Spark command and asks no
 * classifier: it is a decision about rows this database already holds.
 */
import type { DatabaseSync } from 'node:sqlite'
import { z } from 'zod'
import { mailboxCopyId, type MailboxCopyRef } from '../domain/mailbox-copy'
import {
  admitReview,
  humanReviewSchema,
  type HumanReview,
  type ReviewRefusal,
} from '../domain/review'
import { projectClassification, type CurrentJudge } from '../domain/stored-classification'
import { readByCopy } from './by-copy'
import { transaction } from './database'
import { readJudgments } from './judgments'

export type RecordedReview =
  Readonly<{ status: 'recorded' }> | Readonly<{ status: 'refused'; reason: ReviewRefusal }>

/**
 * Names the one classified judgment the review is about, by the subject it
 * judged, which is that table's unique key. The review's own columns repeat
 * that version rather than leaning on the join: the row then keeps saying
 * what was reviewed, whatever a later run judges.
 */
const insert = `
  INSERT INTO reviews (
    judgment_id, mailbox_id, message_id, thread_id, latest_message_id, rubric,
    classifier_version, decision, category, priority, reviewer, reviewed_at
  )
  SELECT j.id, :mailboxId, :messageId, :threadId, :latestMessageId, :rubric,
         :classifierVersion, :decision, :category, :priority, :reviewer, :reviewedAt
  FROM judgments j
  WHERE j.mailbox_id = :mailboxId AND j.thread_id = :threadId
    AND j.latest_message_id = :latestMessageId AND j.rubric = :rubric
    AND j.requested_model = :classifierVersion AND j.status = 'classified'`

/** What a correction chose, or nothing at all when a review confirmed. */
const chosen = (verdict: HumanReview['verdict']) =>
  verdict.decision === 'corrected'
    ? { category: verdict.labels.category, priority: verdict.labels.priority }
    : { category: null, priority: null }

/**
 * Appends one review, or says why it was refused. `judge` is the rubric and
 * classifier build this application uses now; a classification named under
 * any other is not current, and a review of it is refused.
 */
export function recordReview(
  db: DatabaseSync,
  review: HumanReview,
  judge: CurrentJudge,
): RecordedReview {
  const subject = review.classification
  const { copy } = subject
  return transaction(db, () => {
    const stored = readJudgments(db, [copy]).get(mailboxCopyId(copy)) ?? []
    const admission = admitReview(review, projectClassification(stored, judge))
    if (admission.status === 'refused') return admission
    const written = db.prepare(insert).run({
      mailboxId: copy.mailboxId,
      messageId: copy.messageId,
      threadId: subject.threadId,
      latestMessageId: subject.latestMessageId,
      rubric: subject.rubric,
      classifierVersion: subject.classifierVersion,
      decision: review.verdict.decision,
      ...chosen(review.verdict),
      reviewer: review.reviewer,
      reviewedAt: review.reviewedAt,
    })
    // The admitted classification came from a classified judgment with this
    // exact subject, so the select above finds it. Storing nothing is still
    // reported rather than passed off as a recorded review.
    return Number(written.changes) === 1
      ? ({ status: 'recorded' } as const)
      : ({ status: 'refused', reason: 'unclassified' } as const)
  })
}

/** Every review of one mailbox copy, newest first. */
const query = `
  SELECT thread_id, latest_message_id, rubric, classifier_version,
         decision, category, priority, reviewer, reviewed_at
  FROM reviews
  WHERE mailbox_id = :mailboxId AND message_id = :messageId
  ORDER BY reviewed_at DESC, id DESC`

const rowsSchema = z.array(
  z.object({
    thread_id: z.string(),
    latest_message_id: z.string(),
    rubric: z.string(),
    classifier_version: z.string(),
    decision: z.string(),
    category: z.string().nullable(),
    priority: z.string().nullable(),
    reviewer: z.string(),
    reviewed_at: z.string(),
  }),
)

type Row = z.infer<typeof rowsSchema>[number]

const verdictOf = (row: Row) =>
  row.decision === 'corrected'
    ? { decision: 'corrected', labels: { category: row.category, priority: row.priority } }
    : { decision: 'confirmed' }

const reviewOf = (copy: MailboxCopyRef, row: Row) =>
  humanReviewSchema.safeParse({
    classification: {
      copy,
      threadId: row.thread_id,
      latestMessageId: row.latest_message_id,
      rubric: row.rubric,
      classifierVersion: row.classifier_version,
    },
    verdict: verdictOf(row),
    reviewer: row.reviewer,
    reviewedAt: row.reviewed_at,
  })

/**
 * The stored reviews of each named copy, newest first, by copy id. A copy
 * nobody reviewed is absent, which is not an error. A row this build cannot
 * read, such as a correction to a category its rubric no longer knows, is
 * skipped rather than guessed at; it stays in the database either way.
 */
export const readReviews = (
  db: DatabaseSync,
  copies: readonly MailboxCopyRef[],
): ReadonlyMap<string, readonly HumanReview[]> =>
  readByCopy(db, query, rowsSchema, copies, (copy, row) => {
    const parsed = reviewOf(copy, row)
    return parsed.success ? [parsed.data] : []
  })
