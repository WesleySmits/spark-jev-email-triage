/**
 * Browser-safe contract for one explicit, bounded Jev run.
 *
 * Reading mail never creates one of these requests. A person supplies a new
 * request id to Start or Restart, and may safely replay that id after losing
 * the response. The server owns the run id, selection, time and classifier.
 */
import { z } from 'zod'
import type { categorySchema, prioritySchema } from '../domain/triage'

const limitsSchema = z.strictObject({
  maxMessages: z.int().min(1).max(100),
  maxJevCalls: z.int().min(1).max(100),
})

export const triageRunStartSchema = z.strictObject({
  requestId: z.uuid(),
  scope: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('worklist'), reading: z.uuid() }),
    z.strictObject({ kind: z.literal('mailbox'), mailbox: z.email() }),
  ]),
  limits: limitsSchema,
})

export const triageRunRestartSchema = z.strictObject({
  requestId: z.uuid(),
  runId: z.uuid(),
})

export const triageRunIdSchema = z.strictObject({ runId: z.uuid() })

export type TriageRunStart = z.infer<typeof triageRunStartSchema>
export type TriageRunRestart = z.infer<typeof triageRunRestartSchema>
export type TriageRunStatus =
  'queued' | 'running' | 'stopping' | 'stopped' | 'completed' | 'partial' | 'failed' | 'interrupted'

export type TriageRunItemStatus =
  | 'queued'
  | 'already_current'
  | 'duplicate'
  | 'classified'
  | 'provider_failure'
  | 'read_error'
  | 'store_error'
  | 'deferred'

export type TriageRunItem = Readonly<{
  mailbox: string
  messageId: string
  status: TriageRunItemStatus
  category?: z.infer<typeof categorySchema> | undefined
  priority?: z.infer<typeof prioritySchema> | undefined
  needsReview?: boolean | undefined
  errorCode?: string | undefined
}>

export type TriageRunSnapshot = Readonly<{
  runId: string
  sourceRunId?: string | undefined
  scope: Readonly<{ kind: 'worklist' | 'mailbox' | 'restart'; label: string }>
  status: TriageRunStatus
  limits: Readonly<{ maxMessages: number; maxJevCalls: number }>
  counts: Readonly<{
    selected: number
    processed: number
    classified: number
    alreadyCurrent: number
    providerFailures: number
    errors: number
    deferred: number
  }>
  /** Token totals are observable; this code has no price table. */
  cost: Readonly<{
    status: 'price_unavailable'
    jevCalls: number
    inputTokens: number
    outputTokens: number
  }>
  shadowRunIds: readonly number[]
  errorCodes: readonly string[]
  startedAt: string
  finishedAt?: string | undefined
  items: readonly TriageRunItem[]
}>

export type TriageRunStartResult =
  | Readonly<{ status: 'accepted'; run: TriageRunSnapshot }>
  | Readonly<{
      status: 'blocked'
      reason:
        | 'disabled'
        | 'local_only'
        | 'missing_credentials'
        | 'stale_worklist'
        | 'empty_scope'
        | 'mailbox_unavailable'
        | 'store_unavailable'
        | 'run_unavailable'
        | 'run_in_progress'
        | 'request_mismatch'
    }>

export type TriageRunReadResult =
  | Readonly<{ status: 'found'; run: TriageRunSnapshot }>
  | Readonly<{ status: 'absent' | 'unavailable' }>

export type TriageRunStopResult =
  | Readonly<{ status: 'stopping' | 'already_finished'; run: TriageRunSnapshot }>
  | Readonly<{ status: 'absent' | 'unavailable' }>
