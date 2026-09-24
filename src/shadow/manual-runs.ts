/** Durable, content-minimized state for explicit app-started Jev runs. */
import type { DatabaseSync } from 'node:sqlite'
import { z } from 'zod'
import { categorySchema, currentTriageRubric, prioritySchema } from '../domain/triage'
import { jevModel } from '../jev/questions'
import type {
  TriageRunItem,
  TriageRunItemStatus,
  TriageRunSnapshot,
  TriageRunStatus,
} from '../app/triage-run'
import { transaction } from './database'

export interface ManualRunSelection {
  mailboxId: string
  mailboxAddress: string
  messageId: string
}

export interface ManualRunClaim {
  id: string
  requestId: string
  requestPayload: string
  sourceRunId?: string | undefined
  scopeKind: 'worklist' | 'mailbox' | 'restart'
  scopeLabel: string
  maxMessages: number
  maxJevCalls: number
  pid: number
  startedAt: string
  items: readonly ManualRunSelection[]
}

export type ClaimResult =
  | { status: 'created'; runId: string }
  | { status: 'existing'; runId: string }
  | { status: 'request_mismatch' }
  | { status: 'run_in_progress' }

export function manualRunForRequest(
  db: DatabaseSync,
  requestId: string,
  requestPayload: string,
): { status: 'existing'; runId: string } | { status: 'request_mismatch' } | null {
  const existing = existingRequestSchema
    .optional()
    .parse(
      db
        .prepare('SELECT id, request_payload FROM manual_runs WHERE request_id = :requestId')
        .get({ requestId }),
    )
  if (existing === undefined) return null
  return existing.request_payload === requestPayload
    ? { status: 'existing', runId: existing.id }
    : { status: 'request_mismatch' }
}

const existingRequestSchema = z.object({ id: z.string(), request_payload: z.string() })
const activeRunSchema = z.array(
  z.object({ id: z.string(), pid: z.int(), status: z.enum(['queued', 'running', 'stopping']) }),
)

export function claimManualRun(
  db: DatabaseSync,
  claim: ManualRunClaim,
  isProcessAlive: (pid: number) => boolean,
): ClaimResult {
  return transaction(db, () => {
    const existing = manualRunForRequest(db, claim.requestId, claim.requestPayload)
    if (existing !== null) return existing

    const active = activeRunSchema.parse(
      db
        .prepare(
          "SELECT id, pid, status FROM manual_runs WHERE status IN ('queued', 'running', 'stopping')",
        )
        .all(),
    )
    const live = active.find((run) => isProcessAlive(run.pid))
    if (live !== undefined) return { status: 'run_in_progress' }
    db.prepare(
      `UPDATE manual_runs
       SET status = 'interrupted', finished_at = :finishedAt
       WHERE status IN ('queued', 'running', 'stopping')`,
    ).run({ finishedAt: claim.startedAt })

    db.prepare(
      `INSERT INTO manual_runs (
         id, request_id, request_payload, source_run_id, scope_kind, scope_label,
         status, pid, max_messages, max_jev_calls, started_at
       ) VALUES (
         :id, :requestId, :requestPayload, :sourceRunId, :scopeKind, :scopeLabel,
         'queued', :pid, :maxMessages, :maxJevCalls, :startedAt
       )`,
    ).run({
      id: claim.id,
      requestId: claim.requestId,
      requestPayload: claim.requestPayload,
      sourceRunId: claim.sourceRunId ?? null,
      scopeKind: claim.scopeKind,
      scopeLabel: claim.scopeLabel,
      pid: claim.pid,
      maxMessages: claim.maxMessages,
      maxJevCalls: claim.maxJevCalls,
      startedAt: claim.startedAt,
    })
    const insert = db.prepare(
      `INSERT INTO manual_run_items (
         manual_run_id, position, mailbox_id, mailbox_address, message_id, status
       ) VALUES (:runId, :position, :mailboxId, :mailboxAddress, :messageId, 'queued')`,
    )
    claim.items.forEach((item, position) => insert.run({ runId: claim.id, position, ...item }))
    return { status: 'created', runId: claim.id }
  })
}

export function interruptManualRunIfDead(
  db: DatabaseSync,
  runId: string,
  isProcessAlive: (pid: number) => boolean,
  finishedAt: string,
): void {
  const active = z
    .object({ pid: z.int() })
    .optional()
    .parse(
      db
        .prepare(
          `SELECT pid FROM manual_runs
           WHERE id = :runId AND status IN ('queued', 'running', 'stopping')`,
        )
        .get({ runId }),
    )
  if (active !== undefined && !isProcessAlive(active.pid)) {
    db.prepare(
      `UPDATE manual_runs SET status = 'interrupted', finished_at = :finishedAt
       WHERE id = :runId AND status IN ('queued', 'running', 'stopping')`,
    ).run({ runId, finishedAt })
  }
}

export function markManualRunRunning(db: DatabaseSync, runId: string): void {
  db.prepare(
    "UPDATE manual_runs SET status = 'running' WHERE id = :runId AND status = 'queued'",
  ).run({
    runId,
  })
}

export function linkShadowRun(
  db: DatabaseSync,
  manualRunId: string,
  mailboxId: string,
  shadowRunId: number,
): void {
  db.prepare(
    `UPDATE manual_run_items SET shadow_run_id = :shadowRunId
     WHERE manual_run_id = :manualRunId AND mailbox_id = :mailboxId AND status = 'queued'`,
  ).run({ manualRunId, mailboxId, shadowRunId })
}

export function markManualRunItem(
  db: DatabaseSync,
  runId: string,
  mailboxId: string,
  messageId: string,
  status: Exclude<TriageRunItemStatus, 'queued'>,
): void {
  db.prepare(
    `UPDATE manual_run_items SET status = :status
     WHERE manual_run_id = :runId AND mailbox_id = :mailboxId AND message_id = :messageId`,
  ).run({ runId, mailboxId, messageId, status })
}

export function requestManualRunStop(db: DatabaseSync, runId: string): boolean {
  const result = db
    .prepare(
      `UPDATE manual_runs SET status = 'stopping'
       WHERE id = :runId AND status IN ('queued', 'running')`,
    )
    .run({ runId })
  return result.changes > 0
}

export function activeManualRunOwnedBy(
  db: DatabaseSync,
  runId: string,
  processId: number,
): boolean {
  return (
    db
      .prepare(
        `SELECT 1 FROM manual_runs
         WHERE id = :runId AND pid = :processId
           AND status IN ('queued', 'running', 'stopping')`,
      )
      .get({ runId, processId }) !== undefined
  )
}

/** Durable stop state, visible to the process that owns the running job. */
export function manualRunStopRequested(db: DatabaseSync, runId: string): boolean {
  return (
    db
      .prepare("SELECT 1 FROM manual_runs WHERE id = :runId AND status = 'stopping'")
      .get({ runId }) !== undefined
  )
}

export function deferQueuedManualRunItems(db: DatabaseSync, runId: string): void {
  db.prepare(
    "UPDATE manual_run_items SET status = 'deferred' WHERE manual_run_id = :runId AND status = 'queued'",
  ).run({ runId })
}

export function finishManualRun(
  db: DatabaseSync,
  runId: string,
  finish: {
    status: Exclude<TriageRunStatus, 'queued' | 'running' | 'stopping'>
    at: string
    errors: string[]
  },
): void {
  db.prepare(
    `UPDATE manual_runs
     SET status = :status, finished_at = :finishedAt, error_codes = :errorCodes
     WHERE id = :runId`,
  ).run({
    runId,
    status: finish.status,
    finishedAt: finish.at,
    errorCodes: JSON.stringify([...new Set(finish.errors)]),
  })
}

const runRowSchema = z.object({
  id: z.string(),
  source_run_id: z.string().nullable(),
  scope_kind: z.enum(['worklist', 'mailbox', 'restart']),
  scope_label: z.string(),
  status: z.enum([
    'queued',
    'running',
    'stopping',
    'stopped',
    'completed',
    'partial',
    'failed',
    'interrupted',
  ]),
  max_messages: z.int(),
  max_jev_calls: z.int(),
  started_at: z.string(),
  finished_at: z.string().nullable(),
  error_codes: z.string(),
})

const itemRowSchema = z.object({
  mailbox_id: z.string(),
  message_id: z.string(),
  shadow_run_id: z.int().nullable(),
  status: z.enum([
    'queued',
    'already_current',
    'duplicate',
    'classified',
    'provider_failure',
    'read_error',
    'store_error',
    'deferred',
  ]),
})

const judgmentRowSchema = z.object({
  category: z.string().nullable(),
  priority: z.string().nullable(),
  review: z.string(),
  error_code: z.string().nullable(),
})

const shadowIdSchema = z.array(z.object({ shadow_run_id: z.int() }))
const usageSchema = z.object({
  calls: z.int(),
  input_tokens: z.int(),
  output_tokens: z.int(),
})

export function readManualRun(db: DatabaseSync, runId: string): TriageRunSnapshot | null {
  const row = runRowSchema
    .optional()
    .parse(db.prepare('SELECT * FROM manual_runs WHERE id = :runId').get({ runId }))
  if (row === undefined) return null
  const itemRows = itemRowSchema.array().parse(
    db
      .prepare(
        `SELECT mailbox_id, message_id, shadow_run_id, status FROM manual_run_items
         WHERE manual_run_id = :runId ORDER BY position`,
      )
      .all({ runId }),
  )
  const items = itemRows.map((item) => projectItem(db, item))
  const shadowRunIds = shadowIdSchema
    .parse(
      db
        .prepare(
          `SELECT DISTINCT shadow_run_id FROM manual_run_items
           WHERE manual_run_id = :runId AND shadow_run_id IS NOT NULL
           ORDER BY shadow_run_id`,
        )
        .all({ runId }),
    )
    .map(({ shadow_run_id }) => shadow_run_id)
  const usage = usageSchema.parse(
    db
      .prepare(
        `SELECT COUNT(*) AS calls,
                COALESCE(SUM(input_tokens), 0) AS input_tokens,
                COALESCE(SUM(output_tokens), 0) AS output_tokens
         FROM judgments
         WHERE run_id IN (
           SELECT DISTINCT shadow_run_id FROM manual_run_items
           WHERE manual_run_id = :runId AND shadow_run_id IS NOT NULL
         )`,
      )
      .get({ runId }),
  )
  const count = (status: TriageRunItemStatus) =>
    items.filter((item) => item.status === status).length
  const processed = items.filter((item) => item.status !== 'queued').length
  const storedErrors = z.array(z.string()).parse(JSON.parse(row.error_codes) as unknown)
  const itemErrors = items.flatMap((item) => (item.errorCode ? [item.errorCode] : []))
  return {
    runId: row.id,
    ...(row.source_run_id === null ? {} : { sourceRunId: row.source_run_id }),
    scope: { kind: row.scope_kind, label: row.scope_label },
    status: row.status,
    limits: { maxMessages: row.max_messages, maxJevCalls: row.max_jev_calls },
    counts: {
      selected: items.length,
      processed,
      classified: count('classified'),
      alreadyCurrent: count('already_current'),
      providerFailures: count('provider_failure'),
      errors: count('provider_failure') + count('read_error') + count('store_error'),
      deferred: count('deferred'),
    },
    cost: {
      status: 'price_unavailable',
      jevCalls: usage.calls,
      inputTokens: usage.input_tokens,
      outputTokens: usage.output_tokens,
    },
    shadowRunIds,
    errorCodes: [...new Set([...storedErrors, ...itemErrors])],
    startedAt: row.started_at,
    ...(row.finished_at === null ? {} : { finishedAt: row.finished_at }),
    items,
  }
}

function projectItem(db: DatabaseSync, row: z.infer<typeof itemRowSchema>): TriageRunItem {
  const judgment = judgmentForItem(db, row)
  return {
    mailbox: row.mailbox_id,
    messageId: row.message_id,
    status: row.status,
    ...(judgment?.category ? { category: categorySchema.parse(judgment.category) } : {}),
    ...(judgment?.priority ? { priority: prioritySchema.parse(judgment.priority) } : {}),
    ...(judgment ? { needsReview: judgment.review === 'needs_review' } : {}),
    ...(judgment?.error_code ? { errorCode: judgment.error_code } : {}),
  }
}

function judgmentForItem(db: DatabaseSync, row: z.infer<typeof itemRowSchema>) {
  const mayHaveJudgment = row.status === 'classified' || row.status === 'provider_failure'
  if (!mayHaveJudgment || row.shadow_run_id === null) return undefined
  return judgmentRowSchema.optional().parse(
    db
      .prepare(
        `SELECT j.category, j.priority, j.review, j.error_code
         FROM judgment_messages m
         JOIN judgments j ON j.id = m.judgment_id
         WHERE m.mailbox_id = :mailboxId AND m.message_id = :messageId
           AND j.run_id = :shadowRunId
           AND j.rubric = :rubric AND j.requested_model = :model
         LIMIT 1`,
      )
      .get({
        mailboxId: row.mailbox_id,
        messageId: row.message_id,
        shadowRunId: row.shadow_run_id,
        rubric: currentTriageRubric,
        model: jevModel,
      }),
  )
}

export function selectionForManualRun(db: DatabaseSync, runId: string): ManualRunSelection[] {
  return z
    .array(
      z.object({
        mailboxId: z.string(),
        mailboxAddress: z.string(),
        messageId: z.string(),
      }),
    )
    .parse(
      db
        .prepare(
          `SELECT mailbox_id AS mailboxId, mailbox_address AS mailboxAddress,
                  message_id AS messageId
           FROM manual_run_items WHERE manual_run_id = :runId ORDER BY position`,
        )
        .all({ runId }),
    )
}
