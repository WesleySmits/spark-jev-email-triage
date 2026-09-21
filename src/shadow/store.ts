/**
 * Reads and writes shadow-triage rows. Every write that belongs to one
 * thread's outcome happens in one transaction.
 *
 * A judgment is identified by mailbox, thread, the thread's latest message,
 * rubric, and requested model. A new message, rubric, or model therefore
 * gets a new judgment and keeps the old ones as history. A provider failure
 * is stored too, and is retried and overwritten by a later run; a
 * classified judgment is never overwritten.
 */
import type { DatabaseSync, SQLInputValue } from 'node:sqlite'
import { z } from 'zod'
import type { JevClassification } from '../jev/classifier'
import type { TriageOutcome } from '../jev/policy'
import { transaction } from './database'

const runStatuses = ['running', 'completed', 'partial', 'failed', 'interrupted'] as const
export type RunStatus = (typeof runStatuses)[number]

export interface RunCounts {
  listed: number
  skipped: number
  duplicates: number
  classified: number
  needsReview: number
  providerFailures: number
  readErrors: number
  storeErrors: number
  deferred: number
}

interface Version {
  mailboxId: string
  rubric: string
  model: string
}

/** Only the named parameters a query uses; node:sqlite rejects others. */
const version = ({ mailboxId, rubric, model }: Version) => ({ mailboxId, rubric, model })

const runningRows = z.array(z.object({ id: z.int(), pid: z.int().nullable() }))

export type RunClaim =
  { runId: number; interruptedRuns: number } | { runId: null; liveRunId: number }

/**
 * Starts a run unless another live process is running one. Runs left
 * `running` by a process that no longer exists become `interrupted`; none
 * of them is complete. Checking and claiming happen in one write
 * transaction, so two processes cannot both start.
 */
export function beginRun(
  db: DatabaseSync,
  run: Version & { startedAt: string; pid: number },
  isProcessAlive: (pid: number) => boolean,
): RunClaim {
  return transaction(db, () => {
    const running = runningRows.parse(
      db.prepare("SELECT id, pid FROM runs WHERE status = 'running'").all(),
    )
    const live = running.find((row) => row.pid !== null && isProcessAlive(row.pid))
    if (live !== undefined) return { runId: null, liveRunId: live.id }
    db.prepare(
      "UPDATE runs SET status = 'interrupted', finished_at = :startedAt WHERE status = 'running'",
    ).run({ startedAt: run.startedAt })
    const result = db
      .prepare(
        `INSERT INTO runs (mailbox_id, rubric, model, status, pid, started_at)
         VALUES (:mailboxId, :rubric, :model, 'running', :pid, :startedAt)`,
      )
      .run({ ...version(run), pid: run.pid, startedAt: run.startedAt })
    return { runId: Number(result.lastInsertRowid), interruptedRuns: running.length }
  })
}

export function finishRun(
  db: DatabaseSync,
  runId: number,
  finish: {
    status: Exclude<RunStatus, 'running'>
    counts: RunCounts
    errorCode: string | null
    finishedAt: string
  },
): void {
  const { counts } = finish
  db.prepare(
    `UPDATE runs SET status = :status, finished_at = :finishedAt, error_code = :errorCode,
       listed = :listed, skipped = :skipped, duplicates = :duplicates,
       classified = :classified, needs_review = :needsReview,
       provider_failures = :providerFailures,
       read_errors = :readErrors, store_errors = :storeErrors, deferred = :deferred
     WHERE id = :runId`,
  ).run({
    runId,
    status: finish.status,
    finishedAt: finish.finishedAt,
    errorCode: finish.errorCode,
    listed: counts.listed,
    skipped: counts.skipped,
    duplicates: counts.duplicates,
    classified: counts.classified,
    needsReview: counts.needsReview,
    providerFailures: counts.providerFailures,
    readErrors: counts.readErrors,
    storeErrors: counts.storeErrors,
    deferred: counts.deferred,
  })
}

/** Whether a classified judgment for this rubric and model already covers the message. */
export function isMessageJudged(db: DatabaseSync, key: Version & { messageId: string }): boolean {
  const row = db
    .prepare(
      `SELECT 1 FROM judgment_messages m JOIN judgments j ON j.id = m.judgment_id
       WHERE m.mailbox_id = :mailboxId AND m.message_id = :messageId
         AND j.rubric = :rubric AND j.requested_model = :model AND j.status = 'classified'
       LIMIT 1`,
    )
    .get({ ...version(key), messageId: key.messageId })
  return row !== undefined
}

export function isThreadJudged(
  db: DatabaseSync,
  key: Version & { threadId: string; latestMessageId: string },
): boolean {
  const row = db
    .prepare(
      `SELECT 1 FROM judgments
       WHERE mailbox_id = :mailboxId AND thread_id = :threadId
         AND latest_message_id = :latestMessageId AND rubric = :rubric
         AND requested_model = :model AND status = 'classified'`,
    )
    .get({ ...version(key), threadId: key.threadId, latestMessageId: key.latestMessageId })
  return row !== undefined
}

export interface JudgedThread {
  id: string
  latestMessageId: string
  messageIds: readonly string[]
  /** Scrubbed and truncated, as sent to the classifier. */
  subject: string | null
  senderAddress: string
  senderName: string | null
}

/** Stores one thread's outcome atomically. */
export function recordJudgment(
  db: DatabaseSync,
  entry: {
    runId: number
    mailboxId: string
    thread: JudgedThread
    classification: JevClassification
    outcome: TriageOutcome
    judgedAt: string
  },
): void {
  const { mailboxId, thread, judgedAt } = entry
  transaction(db, () => {
    upsertThread(db, mailboxId, thread, judgedAt)
    const judgment = insertedId.parse(
      db
        .prepare(
          `INSERT INTO judgments (
           mailbox_id, thread_id, latest_message_id, rubric, requested_model, run_id, status,
           answered_model, input_tokens, output_tokens, category, category_confidence,
           priority, priority_uncertain, review, review_priority, reasons, reply_expected,
           deadline, suspicion_signals, answers, error_code, error_detail, http_status, judged_at
         ) VALUES (
           :mailboxId, :threadId, :latestMessageId, :rubric, :requestedModel, :runId, :status,
           :answeredModel, :inputTokens, :outputTokens, :category, :categoryConfidence,
           :priority, :priorityUncertain, :review, :reviewPriority, :reasons, :replyExpected,
           :deadline, :suspicionSignals, :answers, :errorCode, :errorDetail, :httpStatus, :judgedAt
         )
         ON CONFLICT (mailbox_id, thread_id, latest_message_id, rubric, requested_model)
         DO UPDATE SET
           run_id = excluded.run_id, status = excluded.status,
           answered_model = excluded.answered_model, input_tokens = excluded.input_tokens,
           output_tokens = excluded.output_tokens, category = excluded.category,
           category_confidence = excluded.category_confidence, priority = excluded.priority,
           priority_uncertain = excluded.priority_uncertain, review = excluded.review,
           review_priority = excluded.review_priority, reasons = excluded.reasons,
           reply_expected = excluded.reply_expected, deadline = excluded.deadline,
           suspicion_signals = excluded.suspicion_signals, answers = excluded.answers,
           error_code = excluded.error_code, error_detail = excluded.error_detail,
           http_status = excluded.http_status, judged_at = excluded.judged_at,
           attempts = judgments.attempts + 1
         WHERE judgments.status = 'provider_failure'
         RETURNING id`,
        )
        .get({
          mailboxId,
          threadId: thread.id,
          latestMessageId: thread.latestMessageId,
          runId: entry.runId,
          judgedAt,
          ...judgmentValues(entry.classification, entry.outcome),
        }),
    )
    // No row: a classified judgment already exists and stays as it is.
    if (judgment === undefined) return
    const cover = db.prepare(
      `INSERT OR IGNORE INTO judgment_messages (judgment_id, mailbox_id, message_id)
       VALUES (:judgmentId, :mailboxId, :messageId)`,
    )
    for (const messageId of thread.messageIds) {
      cover.run({ judgmentId: judgment.id, mailboxId, messageId })
    }
  })
}

function upsertThread(db: DatabaseSync, mailboxId: string, thread: JudgedThread, seenAt: string) {
  db.prepare(
    `INSERT INTO threads (
       mailbox_id, thread_id, subject, sender_address, sender_name, latest_message_id,
       message_count, first_seen_at, last_seen_at
     ) VALUES (
       :mailboxId, :threadId, :subject, :senderAddress, :senderName, :latestMessageId,
       :messageCount, :seenAt, :seenAt
     )
     ON CONFLICT (mailbox_id, thread_id) DO UPDATE SET
       subject = excluded.subject, sender_address = excluded.sender_address,
       sender_name = excluded.sender_name, latest_message_id = excluded.latest_message_id,
       message_count = excluded.message_count, last_seen_at = excluded.last_seen_at`,
  ).run({
    mailboxId,
    threadId: thread.id,
    subject: thread.subject,
    senderAddress: thread.senderAddress,
    senderName: thread.senderName,
    latestMessageId: thread.latestMessageId,
    messageCount: thread.messageIds.length,
    seenAt,
  })
}

type JudgmentValues = Record<string, SQLInputValue>

function judgmentValues(classification: JevClassification, outcome: TriageOutcome): JudgmentValues {
  const shared = {
    rubric: classification.rubric,
    requestedModel: classification.requestedModel,
    review: outcome.review,
    reviewPriority: outcome.reviewPriority,
    reasons: JSON.stringify(outcome.reasons),
  }
  if (classification.status === 'provider_failure' || outcome.status === 'unclassified') {
    const failure = classification.status === 'provider_failure' ? classification.failure : null
    return { ...shared, ...emptyJudgment, ...failureValues(failure) }
  }
  return {
    ...shared,
    status: 'classified',
    answeredModel: classification.model,
    inputTokens: classification.usage.inputTokens,
    outputTokens: classification.usage.outputTokens,
    category: outcome.category,
    categoryConfidence: outcome.confidence,
    priority: outcome.priority,
    priorityUncertain: outcome.priorityUncertain ? 1 : 0,
    replyExpected: outcome.replyExpected,
    deadline: outcome.deadline,
    suspicionSignals: JSON.stringify(outcome.suspicionSignals),
    answers: JSON.stringify(classification.answers),
    errorCode: null,
    errorDetail: null,
    httpStatus: null,
  }
}

const emptyJudgment = {
  status: 'provider_failure',
  answeredModel: null,
  inputTokens: null,
  outputTokens: null,
  category: null,
  categoryConfidence: null,
  priority: null,
  priorityUncertain: null,
  replyExpected: null,
  deadline: null,
  suspicionSignals: '[]',
  answers: null,
} satisfies JudgmentValues

const failureValues = (
  failure: Extract<JevClassification, { status: 'provider_failure' }>['failure'] | null,
) => ({
  errorCode: failure?.code ?? null,
  errorDetail: failure?.detail ?? null,
  httpStatus: failure?.httpStatus ?? null,
})

const insertedId = z.object({ id: z.int().positive() }).optional()

const count = z.int().nonnegative()

const runRowSchema = z.object({
  id: z.int().positive(),
  mailbox_id: z.string(),
  rubric: z.string(),
  model: z.string(),
  status: z.enum(runStatuses),
  pid: z.int().nullable(),
  started_at: z.string(),
  finished_at: z.string().nullable(),
  listed: count,
  skipped: count,
  duplicates: count,
  classified: count,
  needs_review: count,
  provider_failures: count,
  read_errors: count,
  store_errors: count,
  deferred: count,
  error_code: z.string().nullable(),
})

export function readRun(db: DatabaseSync, runId: number): z.infer<typeof runRowSchema> {
  return runRowSchema.parse(db.prepare('SELECT * FROM runs WHERE id = :runId').get({ runId }))
}
