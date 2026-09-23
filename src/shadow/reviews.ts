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
import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { z } from 'zod'
import { mailboxCopyId, type MailboxCopyRef } from '../domain/mailbox-copy'
import {
  admitReview,
  humanReviewSchema,
  utcInstant,
  type EffectiveOutcome,
  type HumanReview,
  type ReviewRefusal,
} from '../domain/review'
import { projectClassification, type CurrentJudge } from '../domain/stored-classification'
import { categorySchema, prioritySchema } from '../domain/triage'
import { readByCopy } from './by-copy'
import { transaction } from './database'
import { readJudgments } from './judgments'

export type RecordedReview =
  Readonly<{ status: 'recorded' }> | Readonly<{ status: 'refused'; reason: ReviewRefusal }>

type ReviewRequest = Readonly<
  Pick<HumanReview, 'classification' | 'verdict'> & { requestId: string }
>
type SavedReview = Extract<EffectiveOutcome, { decidedBy: 'reviewer' }>
export type ReviewRequestResult =
  | Readonly<{ status: 'absent' }>
  | Readonly<{ status: 'recorded'; review: SavedReview }>
  | Readonly<{ status: 'refused'; reason: ReviewRefusal }>

/** Stable content for comparing a retry, excluding server-chosen reviewer and time. */
const requestPayload = (request: ReviewRequest) =>
  JSON.stringify({ classification: request.classification, verdict: request.verdict })

const requestRowSchema = z.object({
  payload: z.string(),
  status: z.enum(['recorded', 'refused']),
  refusal_reason: z.string().nullable(),
  decision: z.string().nullable(),
  category: z.string().nullable(),
  priority: z.string().nullable(),
  reviewer: z.string().nullable(),
  reviewed_at: z.string().nullable(),
  model_category: z.string().nullable(),
  model_priority: z.string().nullable(),
})

/** The original result of a Save, including the review as it was first recorded. */
export function readReviewRequest(db: DatabaseSync, request: ReviewRequest): ReviewRequestResult {
  const raw = db
    .prepare(
      `SELECT r.payload, r.status, r.refusal_reason, v.decision, v.category, v.priority,
              v.reviewer, v.reviewed_at, j.category AS model_category,
              j.priority AS model_priority
       FROM review_requests r
       LEFT JOIN reviews v ON v.id = r.review_id
       LEFT JOIN judgments j ON j.id = v.judgment_id
       WHERE r.request_id = :requestId`,
    )
    .get({ requestId: request.requestId })
  if (raw === undefined) return { status: 'absent' }
  const row = requestRowSchema.parse(raw)
  if (row.payload !== requestPayload(request)) {
    return { status: 'refused', reason: 'request_conflict' }
  }
  if (row.status === 'refused') {
    return { status: 'refused', reason: reviewRefusalSchema.parse(row.refusal_reason) }
  }
  const decision = z.enum(['confirmed', 'corrected']).parse(row.decision)
  const labels =
    decision === 'corrected'
      ? {
          category: categorySchema.parse(row.category),
          priority: prioritySchema.parse(row.priority),
        }
      : {
          category: categorySchema.parse(row.model_category),
          priority: prioritySchema.parse(row.model_priority),
        }
  return {
    status: 'recorded',
    review: {
      decidedBy: 'reviewer',
      decision,
      labels,
      reviewer: z.string().min(1).parse(row.reviewer),
      reviewedAt: z.iso.datetime().parse(row.reviewed_at),
    },
  }
}

const reviewRefusalSchema = z.enum([
  'stale_subject',
  'unclassified',
  'other_copy',
  'unreadable',
  'request_conflict',
])

/** Persist a refusal or a recorded review in the same write transaction. */
function remember(
  db: DatabaseSync,
  request: ReviewRequest,
  result: RecordedReview,
  reviewId: number | null,
) {
  db.prepare(
    `INSERT INTO review_requests
       (request_id, payload, status, refusal_reason, review_id)
     VALUES (:requestId, :payload, :status, :reason, :reviewId)`,
  ).run({
    requestId: request.requestId,
    payload: requestPayload(request),
    status: result.status,
    reason: result.status === 'refused' ? result.reason : null,
    reviewId,
  })
}

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
  requestId: string = randomUUID(),
): RecordedReview {
  const subject = review.classification
  const { copy } = subject
  const request = { requestId, classification: subject, verdict: review.verdict }
  return transaction(db, () => {
    const previous = readReviewRequest(db, request)
    if (previous.status !== 'absent') {
      return previous.status === 'recorded'
        ? { status: 'recorded' }
        : { status: 'refused', reason: previous.reason }
    }
    const stored = readJudgments(db, [copy]).get(mailboxCopyId(copy)) ?? []
    const admission = admitReview(review, projectClassification(stored, judge))
    if (admission.status === 'refused') {
      remember(db, request, admission, null)
      return admission
    }
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
      // Stored in UTC, so the column orders by when a review happened.
      reviewedAt: utcInstant(review.reviewedAt),
    })
    // The admitted classification came from a classified judgment with this
    // exact subject, so the select above finds it. Storing nothing is still
    // reported rather than passed off as a recorded review.
    const result: RecordedReview =
      Number(written.changes) === 1
        ? { status: 'recorded' }
        : { status: 'refused', reason: 'unclassified' }
    remember(
      db,
      request,
      result,
      result.status === 'recorded' ? Number(written.lastInsertRowid) : null,
    )
    return result
  })
}

/**
 * Every review of one mailbox copy, newest first. The order comes from the
 * instant each row names, not from its text: this module writes UTC, and a
 * row another writer left in some other offset still sorts by when it
 * happened. One whose time SQLite cannot read sorts last rather than newest.
 */
const query = `
  SELECT thread_id, latest_message_id, rubric, classifier_version,
         decision, category, priority, reviewer, reviewed_at
  FROM reviews
  WHERE mailbox_id = :mailboxId AND message_id = :messageId
  ORDER BY strftime('%Y-%m-%dT%H:%M:%fZ', reviewed_at) DESC, id DESC`

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
