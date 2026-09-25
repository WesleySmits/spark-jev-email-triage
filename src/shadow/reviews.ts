/**
 * Stores human reviews of stored classifications, and reads them back.
 *
 * A review is appended, never merged: `judgments` is not touched, so what
 * the classifier proposed survives every confirmation and correction of it,
 * and both of those survive each other. The database enforces that as well
 * as this module does — `reviews` and `review_fields` both carry triggers
 * that refuse an update or a delete — so a later writer cannot quietly
 * rewrite what a person said.
 *
 * A review names one classification and decides its fields one by one.
 * `reviews` holds the review itself: the subject version reviewed, who
 * reviewed and when. `review_fields` holds one row per field that person
 * decided, so a review of the category alone stores nothing about the
 * priority, and reading one back can say which fields a person actually
 * decided rather than inferring it from a label's presence.
 *
 * `reviews.decision`, `reviews.category` and `reviews.priority` stay as the
 * first version of this contract wrote them: the review in one word, and the
 * labels that hold after it where it changed any. They are kept so rows
 * written before field decisions existed still read as what they are, and
 * they are never read as evidence of which field a person assessed. Only
 * `review_fields` says that.
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
  reviewOutcome,
  reviewVerdictSchema,
  utcInstant,
  type HumanReview,
  type ReviewerOutcome,
  type ReviewRefusal,
  type ReviewVerdict,
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
export type ReviewRequestResult =
  | Readonly<{ status: 'absent' }>
  | Readonly<{ status: 'recorded'; review: ReviewerOutcome }>
  | Readonly<{ status: 'refused'; reason: ReviewRefusal }>

/** Stable content for comparing a retry, excluding server-chosen reviewer and time. */
const requestPayload = (request: ReviewRequest) =>
  JSON.stringify({ classification: request.classification, verdict: request.verdict })

const requestRowSchema = z.object({
  payload: z.string(),
  status: z.enum(['recorded', 'refused']),
  refusal_reason: z.string().nullable(),
  review_id: z.int().nullable(),
  reviewer: z.string().nullable(),
  reviewed_at: z.string().nullable(),
  model_category: z.string().nullable(),
  model_priority: z.string().nullable(),
})

const fieldRowSchema = z.object({
  field: z.enum(['category', 'priority']),
  decision: z.enum(['confirmed', 'corrected']),
  value: z.string().nullable(),
})

/**
 * The verdict one review's stored field decisions amount to, or nothing when
 * this build cannot read them. A field code it does not know, a correction
 * with no value and a review with no field decisions at all are all
 * unreadable rather than guessed at: what a person decided is either on
 * record or unknown, never inferred from the labels beside it.
 */
function verdictOf(rows: unknown): ReviewVerdict | undefined {
  const parsed = z.array(fieldRowSchema).safeParse(rows)
  if (!parsed.success) return undefined
  const verdict = Object.fromEntries(
    parsed.data.map((row) => [
      row.field,
      row.decision === 'corrected'
        ? { decision: 'corrected', value: row.value }
        : { decision: 'confirmed' },
    ]),
  )
  const read = reviewVerdictSchema.safeParse(verdict)
  return read.success ? read.data : undefined
}

const fieldsQuery = `
  SELECT field, decision, value FROM review_fields
  WHERE review_id = :reviewId ORDER BY field`

/** The field decisions stored for one review, as they were committed with it. */
const fieldsOf = (db: DatabaseSync, reviewId: number) => db.prepare(fieldsQuery).all({ reviewId })

/** The original result of a Save, including the review as it was first recorded. */
export function readReviewRequest(db: DatabaseSync, request: ReviewRequest): ReviewRequestResult {
  const raw = db
    .prepare(
      `SELECT r.payload, r.status, r.refusal_reason, r.review_id, v.reviewer, v.reviewed_at,
              j.category AS model_category, j.priority AS model_priority
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
  const review = recordedReview(db, row)
  if (review === undefined) throw new Error('A recorded review holds no readable decision')
  return { status: 'recorded', review }
}

/**
 * What one recorded Save stored, projected as the row's outcome: the fields
 * that review decided, against the labels the judgment it named proposed.
 * Nothing where its decisions cannot be read.
 */
function recordedReview(db: DatabaseSync, row: z.infer<typeof requestRowSchema>) {
  const verdict = verdictOf(fieldsOf(db, z.int().parse(row.review_id)))
  if (verdict === undefined) return undefined
  return reviewOutcome(
    {
      verdict,
      reviewer: z.string().min(1).parse(row.reviewer),
      reviewedAt: z.iso.datetime().parse(row.reviewed_at),
    },
    {
      category: categorySchema.parse(row.model_category),
      priority: prioritySchema.parse(row.model_priority),
    },
  )
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
 *
 * `category` and `priority` are the labels that hold after this review: the
 * value a correction chose, and otherwise the one the judgment proposed. They
 * describe the review's result, not which field anyone assessed, which is why
 * a confirmation stores neither. `review_fields` records the decisions.
 */
const insert = `
  INSERT INTO reviews (
    judgment_id, mailbox_id, message_id, thread_id, latest_message_id, rubric,
    classifier_version, decision, category, priority, reviewer, reviewed_at
  )
  SELECT j.id, :mailboxId, :messageId, :threadId, :latestMessageId, :rubric,
         :classifierVersion, :decision,
         CASE WHEN :decision = 'corrected' THEN COALESCE(:category, j.category) END,
         CASE WHEN :decision = 'corrected' THEN COALESCE(:priority, j.priority) END,
         :reviewer, :reviewedAt
  FROM judgments j
  WHERE j.mailbox_id = :mailboxId AND j.thread_id = :threadId
    AND j.latest_message_id = :latestMessageId AND j.rubric = :rubric
    AND j.requested_model = :classifierVersion AND j.status = 'classified'`

const insertField = `
  INSERT INTO review_fields (review_id, field, decision, value)
  VALUES (:reviewId, :field, :decision, :value)`

type Decided = NonNullable<ReviewVerdict['category'] | ReviewVerdict['priority']>

/** One field's row: a correction stores the value it chose, a confirmation none. */
const fieldRow = (field: 'category' | 'priority', decided: Decided) => ({
  field,
  decision: decided.decision,
  value: decided.decision === 'corrected' ? decided.value : null,
})

/** One row per field this review decided, and none for a field it did not. */
const decidedFields = (verdict: ReviewVerdict) => [
  ...(verdict.category === undefined ? [] : [fieldRow('category', verdict.category)]),
  ...(verdict.priority === undefined ? [] : [fieldRow('priority', verdict.priority)]),
]

/** What a correction chose for each field, or nothing where it corrected none. */
const chosen = (verdict: ReviewVerdict) => ({
  category: verdict.category?.decision === 'corrected' ? verdict.category.value : null,
  priority: verdict.priority?.decision === 'corrected' ? verdict.priority.value : null,
})

/**
 * Appends one review, or says why it was refused. `judge` is the rubric and
 * classifier build this application uses now; a classification named under
 * any other is not current, and a review of it is refused.
 *
 * The review and every field decision it carries commit together, so a
 * review that is stored is always stored with what it decided.
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
    const written = writeReview(db, review)
    remember(db, request, written.result, written.reviewId)
    return written.result
  })
}

/**
 * Writes the admitted review and one row per field it decided, inside the
 * transaction its caller opened. The field decisions follow the review they
 * belong to, so a review that is stored is stored with what it decided.
 */
function writeReview(
  db: DatabaseSync,
  review: HumanReview,
): Readonly<{ result: RecordedReview; reviewId: number | null }> {
  const subject = review.classification
  const { copy } = subject
  const corrections = chosen(review.verdict)
  const changed = corrections.category !== null || corrections.priority !== null
  const written = db.prepare(insert).run({
    mailboxId: copy.mailboxId,
    messageId: copy.messageId,
    threadId: subject.threadId,
    latestMessageId: subject.latestMessageId,
    rubric: subject.rubric,
    classifierVersion: subject.classifierVersion,
    decision: changed ? 'corrected' : 'confirmed',
    ...corrections,
    reviewer: review.reviewer,
    // Stored in UTC, so the column orders by when a review happened.
    reviewedAt: utcInstant(review.reviewedAt),
  })
  // The admitted classification came from a classified judgment with this
  // exact subject, so the select above finds it. Storing nothing is still
  // reported rather than passed off as a recorded review.
  if (Number(written.changes) !== 1) {
    return { result: { status: 'refused', reason: 'unclassified' }, reviewId: null }
  }
  const reviewId = Number(written.lastInsertRowid)
  const statement = db.prepare(insertField)
  for (const field of decidedFields(review.verdict)) statement.run({ reviewId, ...field })
  return { result: { status: 'recorded' }, reviewId }
}

/**
 * Every review of one mailbox copy, newest first, with the field decisions
 * stored for each. The order comes from the instant each row names, not from
 * its text: this module writes UTC, and a row another writer left in some
 * other offset still sorts by when it happened. One whose time SQLite cannot
 * read sorts last rather than newest.
 */
const query = `
  SELECT r.thread_id, r.latest_message_id, r.rubric, r.classifier_version,
         r.reviewer, r.reviewed_at,
         (SELECT json_group_array(
                   json_object('field', f.field, 'decision', f.decision, 'value', f.value))
          FROM review_fields f WHERE f.review_id = r.id) AS fields
  FROM reviews r
  WHERE r.mailbox_id = :mailboxId AND r.message_id = :messageId
  ORDER BY strftime('%Y-%m-%dT%H:%M:%fZ', r.reviewed_at) DESC, r.id DESC`

const rowsSchema = z.array(
  z.object({
    thread_id: z.string(),
    latest_message_id: z.string(),
    rubric: z.string(),
    classifier_version: z.string(),
    reviewer: z.string(),
    reviewed_at: z.string(),
    fields: z.string(),
  }),
)

type Row = z.infer<typeof rowsSchema>[number]

/** The decisions a row carries, or nothing when they cannot be read at all. */
function decisionsIn(row: Row): ReviewVerdict | undefined {
  try {
    return verdictOf(JSON.parse(row.fields))
  } catch {
    return undefined
  }
}

const reviewOf = (copy: MailboxCopyRef, row: Row, verdict: ReviewVerdict) =>
  humanReviewSchema.safeParse({
    classification: {
      copy,
      threadId: row.thread_id,
      latestMessageId: row.latest_message_id,
      rubric: row.rubric,
      classifierVersion: row.classifier_version,
    },
    verdict,
    reviewer: row.reviewer,
    reviewedAt: row.reviewed_at,
  })

/**
 * The stored reviews of each named copy, newest first, by copy id. A copy
 * nobody reviewed is absent, which is not an error. A row this build cannot
 * read, such as a correction to a category its rubric no longer knows or one
 * whose field decisions are missing, is skipped rather than guessed at; it
 * stays in the database either way.
 */
export const readReviews = (
  db: DatabaseSync,
  copies: readonly MailboxCopyRef[],
): ReadonlyMap<string, readonly HumanReview[]> =>
  readByCopy(db, query, rowsSchema, copies, (copy, row) => {
    const verdict = decisionsIn(row)
    if (verdict === undefined) return []
    const parsed = reviewOf(copy, row, verdict)
    return parsed.success ? [parsed.data] : []
  })
