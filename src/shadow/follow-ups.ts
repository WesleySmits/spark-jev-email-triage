/**
 * Stores what a person decided about the work one mailbox copy owes, and
 * reads it back.
 *
 * A decision is appended, never merged. Deciding again adds a row, and the
 * database refuses an update and a delete on both tables, so the history of
 * a copy is what the record says it is: who decided what, against which
 * thread version, and when. Nothing edits or removes what somebody said.
 *
 * That history is ordered by the row ids this database assigns, never by the
 * `decidedAt` a caller supplied. A clock corrected between two saves would
 * otherwise reorder them, and a closure could outrank the reopen that
 * answered it. `decidedAt` stays on the row as what the caller said.
 *
 * Every row names the copy and the exact thread version decided against.
 * Whether a stored decision still describes a row is not decided here, and
 * no query filters by version: the reading brings its own observation and
 * `followUpWork` compares the two, so one message arriving cannot turn an
 * old `handled_in_spark` into a current one anywhere in this application.
 *
 * Nothing here reaches a provider. `handled_in_spark` is one person's claim
 * that they finished the message in Spark themselves; no Spark command runs
 * for it, nothing is read back, and no row is evidence that a mailbox
 * changed. The guarded Done path keeps its own approval, receipt and
 * readback.
 *
 * Whether a decision may be recorded at all is the domain's call, made by
 * `admitFollowUp` over what this store holds for the copy. Reading and
 * admitting happen inside the write transaction, so two decisions recorded
 * at once cannot both read the record as it was before either.
 */
import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { z } from 'zod'
import {
  admitFollowUp,
  parseFollowUpDecision,
  type FollowUpDecision,
  type FollowUpRefusal,
} from '../domain/follow-up'
import { mailboxCopyId, type MailboxCopyRef } from '../domain/mailbox-copy'
import { readByCopy } from './by-copy'
import { transaction } from './database'
import { requestOutcome } from './request-journal'

export type RecordedFollowUp =
  Readonly<{ status: 'recorded' }> | Readonly<{ status: 'refused'; reason: FollowUpRefusal }>

export type FollowUpRequest = Readonly<{ decision: FollowUpDecision; requestId: string }>

export type FollowUpRequestResult =
  | Readonly<{ status: 'absent' }>
  | Readonly<{ status: 'recorded'; decision: FollowUpDecision }>
  | Readonly<{ status: 'refused'; reason: FollowUpRefusal }>

/**
 * Stable content for comparing a retry: what was asked for, and who asked.
 * A retry that asks for something else under the same id is a conflict, not
 * a repeat, and so is one that asks for the same thing as somebody else:
 * the decider is part of what is recorded, and treating two people's
 * decisions as one save would store one of them under the other's name.
 *
 * `decidedAt` is deliberately left out. A genuine retry of one save is the
 * same decision even when the caller stamps it again, and comparing the
 * instant would turn every retry into a conflict.
 */
const requestPayload = ({ decision }: FollowUpRequest) =>
  JSON.stringify({
    target: decision.target,
    kind: decision.kind,
    dueAt: decision.dueAt,
    decidedBy: decision.decidedBy,
  })

const refusalSchema = z.enum(['nothing_to_reopen', 'request_conflict'])

const decisionColumns = z.object({
  mailbox_id: z.string(),
  message_id: z.string(),
  thread_id: z.string(),
  latest_message_id: z.string(),
  kind: z.string(),
  due_at: z.string().nullable(),
  decided_by: z.string(),
  decided_at: z.string(),
})

type DecisionRow = z.infer<typeof decisionColumns>

/**
 * One stored row as a decision, or nothing where this build cannot read it:
 * a kind it does not know, or a due date on a kind that takes none. Such a
 * row is skipped rather than guessed at, and stays in the database.
 */
const decisionIn = (row: DecisionRow): FollowUpDecision | null =>
  parseFollowUpDecision({
    target: {
      copy: { mailboxId: row.mailbox_id, messageId: row.message_id },
      threadId: row.thread_id,
      latestMessageId: row.latest_message_id,
    },
    kind: row.kind,
    dueAt: row.due_at,
    decidedBy: row.decided_by,
    decidedAt: row.decided_at,
  })

const requestQuery = `
  SELECT r.payload, r.status, r.refusal_reason,
         d.mailbox_id, d.message_id, d.thread_id, d.latest_message_id,
         d.kind, d.due_at, d.decided_by, d.decided_at
  FROM follow_up_requests r
  LEFT JOIN follow_up_decisions d ON d.id = r.decision_id
  WHERE r.request_id = :requestId`

/** The original result of one Save, including the decision it recorded. */
export function readFollowUpRequest(
  db: DatabaseSync,
  request: FollowUpRequest,
): FollowUpRequestResult {
  const raw = db.prepare(requestQuery).get({ requestId: request.requestId })
  const outcome = requestOutcome(raw, requestPayload(request), refusalSchema)
  if (outcome.status !== 'recorded') return outcome
  // The joined columns are absent where the request recorded no decision,
  // which the table's own checks make impossible for a recorded one.
  const joined = decisionColumns.safeParse(raw)
  const decision = joined.success ? decisionIn(joined.data) : null
  if (decision === null) throw new Error('A recorded decision could not be read back')
  return { status: 'recorded', decision }
}

/** Persist a refusal or a recorded decision in the same write transaction. */
const remember = (
  db: DatabaseSync,
  request: FollowUpRequest,
  result: RecordedFollowUp,
  decisionId: number | null,
) =>
  db
    .prepare(
      `INSERT INTO follow_up_requests
         (request_id, payload, status, refusal_reason, decision_id)
       VALUES (:requestId, :payload, :status, :reason, :decisionId)`,
    )
    .run({
      requestId: request.requestId,
      payload: requestPayload(request),
      status: result.status,
      reason: result.status === 'refused' ? result.reason : null,
      decisionId,
    })

const insert = `
  INSERT INTO follow_up_decisions (
    mailbox_id, message_id, thread_id, latest_message_id,
    kind, due_at, decided_by, decided_at
  )
  VALUES (:mailboxId, :messageId, :threadId, :latestMessageId,
          :kind, :dueAt, :decidedBy, :decidedAt)`

/** Writes the admitted decision inside the transaction its caller opened. */
function write(db: DatabaseSync, decision: FollowUpDecision): number {
  const { target } = decision
  const written = db.prepare(insert).run({
    mailboxId: target.copy.mailboxId,
    messageId: target.copy.messageId,
    threadId: target.threadId,
    latestMessageId: target.latestMessageId,
    kind: decision.kind,
    dueAt: decision.dueAt,
    decidedBy: decision.decidedBy,
    // Stored in UTC, so the column orders by when a person decided.
    decidedAt: decision.decidedAt,
  })
  return Number(written.lastInsertRowid)
}

/**
 * Appends one decision, or says why it was refused. A retry with the same
 * request id reads that request's first result instead of recording a second
 * decision, so a lost answer costs nothing but the retry.
 *
 * The decision and the record of its request commit together, so a decision
 * that is stored is always stored with the request that asked for it.
 */
export function recordFollowUp(
  db: DatabaseSync,
  decision: FollowUpDecision,
  requestId: string = randomUUID(),
): RecordedFollowUp {
  const request = { decision, requestId }
  return transaction(db, () => {
    const previous = readFollowUpRequest(db, request)
    if (previous.status === 'recorded') return { status: 'recorded' }
    if (previous.status === 'refused') return { status: 'refused', reason: previous.reason }
    const copy = decision.target.copy
    const stored = readFollowUps(db, [copy]).get(mailboxCopyId(copy)) ?? []
    const admission = admitFollowUp(decision, stored)
    if (admission.status === 'refused') {
      remember(db, request, admission, null)
      return admission
    }
    const recorded: RecordedFollowUp = { status: 'recorded' }
    remember(db, request, recorded, write(db, decision))
    return recorded
  })
}

/**
 * Every decision recorded for one mailbox copy, latest first, in the order
 * this database committed them.
 *
 * `decided_at` does not order them. It is the instant the caller supplied,
 * and a corrected clock, another offset or a backdated input can put an
 * earlier one on a later save; ordering by it would let a closure saved
 * yesterday outrank the reopen saved after it and hide work somebody
 * reopened. The row id is assigned by SQLite when the row commits, so it
 * says what this record actually received, and the callers that decide
 * where work stands read this order rather than re-sorting it.
 */
const query = `
  SELECT mailbox_id, message_id, thread_id, latest_message_id,
         kind, due_at, decided_by, decided_at
  FROM follow_up_decisions
  WHERE mailbox_id = :mailboxId AND message_id = :messageId
  ORDER BY id DESC`

const rowsSchema = z.array(decisionColumns)

/**
 * The decisions recorded for each named copy, latest first, by copy id. A
 * copy nobody decided about is absent, which is not an error. Copies are
 * looked up one at a time by mailbox and provider message id, so two copies
 * of one delivery keep their own decisions even though Spark would act on
 * the id they share.
 */
export const readFollowUps = (
  db: DatabaseSync,
  copies: readonly MailboxCopyRef[],
): ReadonlyMap<string, readonly FollowUpDecision[]> =>
  readByCopy(db, query, rowsSchema, copies, (_copy, row) => {
    const decision = decisionIn(row)
    return decision === null ? [] : [decision]
  })
