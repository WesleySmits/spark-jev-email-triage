/**
 * Local-only orchestration for explicit, bounded Jev runs.
 *
 * Starting is the only operation that may call Jev. Readback and Stop only
 * touch local durable state. Mail is read through the existing read-only
 * reader; the versioned shadow pipeline owns classification idempotency.
 */
import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import type { MailReader } from '../domain/mail-reader'
import { createJevClassifier } from '../jev/classifier'
import { readJevConfig } from '../jev/config'
import { createSdkTransport } from '../jev/transport'
import { readDatabasePath } from '../shadow/config'
import { openDatabase } from '../shadow/database'
import {
  claimManualRun,
  deferQueuedManualRunItems,
  finishManualRun,
  interruptManualRunIfDead,
  linkShadowRun,
  manualRunStopRequested,
  manualRunForRequest,
  markManualRunItem,
  markManualRunRunning,
  readManualRun,
  requestManualRunStop,
  selectionForManualRun,
  type ManualRunSelection,
} from '../shadow/manual-runs'
import { runShadowTriageSelection } from '../shadow/pipeline'
import { isProcessAlive } from '../shadow/process-liveness'
import type {
  TriageRunReadResult,
  TriageRunRestart,
  TriageRunSnapshot,
  TriageRunStart,
  TriageRunStartResult,
  TriageRunStatus,
  TriageRunStopResult,
} from './triage-run'
import { worklistFor } from './review-desk.server'
import { sparkMailReader } from './spark-inbox.server'

type Classifier = ReturnType<typeof createJevClassifier>

export interface TriageRunDependencies {
  reader: MailReader
  classifier: () => Classifier | null
  open: () => DatabaseSync
  worklist: (reading: string) => readonly ManualRunSelection[] | null
  enabled: () => boolean
  now: () => Date
  newId: () => string
  processId: number
  isProcessAlive: (pid: number) => boolean
}

type PreparedRun = Readonly<{
  requestId: string
  requestPayload: string
  sourceRunId?: string | undefined
  scopeKind: 'worklist' | 'mailbox' | 'restart'
  scopeLabel: string
  maxMessages: number
  maxJevCalls: number
  items: readonly ManualRunSelection[]
}>

export function createTriageRunService(deps: TriageRunDependencies) {
  const jobs = new Map<string, { controller: AbortController; promise: Promise<void> }>()

  const opened = (): DatabaseSync | null => {
    try {
      return deps.open()
    } catch {
      return null
    }
  }

  const readFrom = (db: DatabaseSync, runId: string): TriageRunSnapshot | null => {
    interruptManualRunIfDead(db, runId, deps.isProcessAlive, deps.now().toISOString())
    return readManualRun(db, runId)
  }

  const replay = (
    db: DatabaseSync,
    requestId: string,
    requestPayload: string,
  ): TriageRunStartResult | null => {
    const existing = manualRunForRequest(db, requestId, requestPayload)
    if (existing === null) return null
    if (existing.status === 'request_mismatch') {
      return { status: 'blocked', reason: 'request_mismatch' }
    }
    const run = readFrom(db, existing.runId)
    return run === null
      ? { status: 'blocked', reason: 'store_unavailable' }
      : { status: 'accepted', run }
  }

  const accept = (prepared: PreparedRun): TriageRunStartResult => {
    const db = opened()
    if (db === null) return { status: 'blocked', reason: 'store_unavailable' }
    try {
      const replayed = replay(db, prepared.requestId, prepared.requestPayload)
      if (replayed !== null) return replayed
      if (prepared.items.length === 0) return { status: 'blocked', reason: 'empty_scope' }
      const id = deps.newId()
      const claim = claimManualRun(
        db,
        {
          id,
          requestId: prepared.requestId,
          requestPayload: prepared.requestPayload,
          sourceRunId: prepared.sourceRunId,
          scopeKind: prepared.scopeKind,
          scopeLabel: prepared.scopeLabel,
          maxMessages: prepared.maxMessages,
          maxJevCalls: prepared.maxJevCalls,
          pid: deps.processId,
          startedAt: deps.now().toISOString(),
          items: uniqueSelection(prepared.items).slice(0, prepared.maxMessages),
        },
        deps.isProcessAlive,
      )
      if (claim.status === 'request_mismatch') {
        return { status: 'blocked', reason: 'request_mismatch' }
      }
      if (claim.status === 'run_in_progress') {
        return { status: 'blocked', reason: 'run_in_progress' }
      }
      if (claim.status === 'created' && !kick(claim.runId)) {
        finishManualRun(db, claim.runId, {
          status: 'failed',
          at: deps.now().toISOString(),
          errors: ['store_unavailable'],
        })
      }
      const run = readFrom(db, claim.runId)
      return run === null
        ? { status: 'blocked', reason: 'store_unavailable' }
        : { status: 'accepted', run }
    } finally {
      db.close()
    }
  }

  const start = async (
    request: TriageRunStart,
    signal?: AbortSignal,
  ): Promise<TriageRunStartResult> => {
    const requestPayload = JSON.stringify(request)
    const first = opened()
    if (first === null) return { status: 'blocked', reason: 'store_unavailable' }
    try {
      const replayed = replay(first, request.requestId, requestPayload)
      if (replayed !== null) return replayed
    } finally {
      first.close()
    }
    // Configuration gates control new work, never durable readback of an
    // already accepted request whose response may have been lost.
    if (!safeEnabled(deps.enabled)) return { status: 'blocked', reason: 'disabled' }
    if (deps.classifier() === null) return { status: 'blocked', reason: 'missing_credentials' }
    const selected = await selectItems(deps, request, signal)
    if (selected.status !== 'ready') return { status: 'blocked', reason: selected.reason }
    return accept({
      requestId: request.requestId,
      requestPayload,
      scopeKind: request.scope.kind,
      scopeLabel: selected.label,
      maxMessages: request.limits.maxMessages,
      maxJevCalls: request.limits.maxJevCalls,
      items: selected.items,
    })
  }

  const restart = (request: TriageRunRestart): TriageRunStartResult => {
    const requestPayload = JSON.stringify(request)
    const db = opened()
    if (db === null) return { status: 'blocked', reason: 'store_unavailable' }
    let previous: TriageRunSnapshot | null
    let items: ManualRunSelection[]
    try {
      const replayed = replay(db, request.requestId, requestPayload)
      if (replayed !== null) return replayed
      // As with Start, gates apply only after an exact request-id replay miss.
      if (!safeEnabled(deps.enabled)) return { status: 'blocked', reason: 'disabled' }
      if (deps.classifier() === null) return { status: 'blocked', reason: 'missing_credentials' }
      previous = readFrom(db, request.runId)
      if (previous === null) return { status: 'blocked', reason: 'run_unavailable' }
      items = selectionForManualRun(db, request.runId)
    } finally {
      db.close()
    }
    return accept({
      requestId: request.requestId,
      requestPayload,
      sourceRunId: request.runId,
      scopeKind: 'restart',
      scopeLabel: previous.scope.label,
      maxMessages: previous.limits.maxMessages,
      maxJevCalls: previous.limits.maxJevCalls,
      items,
    })
  }

  const read = (runId: string): TriageRunReadResult => {
    const db = opened()
    if (db === null) return { status: 'unavailable' }
    try {
      const run = readFrom(db, runId)
      return run === null ? { status: 'absent' } : { status: 'found', run }
    } catch {
      return { status: 'unavailable' }
    } finally {
      db.close()
    }
  }

  const stop = (runId: string): TriageRunStopResult => {
    const db = opened()
    if (db === null) return { status: 'unavailable' }
    try {
      const before = readFrom(db, runId)
      if (before === null) return { status: 'absent' }
      const changed = requestManualRunStop(db, runId)
      if (changed) jobs.get(runId)?.controller.abort()
      const run = readFrom(db, runId)
      if (run === null) return { status: 'absent' }
      return { status: changed ? 'stopping' : 'already_finished', run }
    } catch {
      return { status: 'unavailable' }
    } finally {
      db.close()
    }
  }

  function kick(runId: string): boolean {
    const db = opened()
    if (db === null) return false
    const controller = new AbortController()
    const promise = runJob(db, runId, controller)
      .catch(() => undefined)
      .finally(() => jobs.delete(runId))
    jobs.set(runId, { controller, promise })
    return true
  }

  async function runJob(
    db: DatabaseSync,
    runId: string,
    controller: AbortController,
  ): Promise<void> {
    let errors: string[] = []
    try {
      const run = readManualRun(db, runId)
      if (run === null) return
      const classifier = deps.classifier()
      if (classifier === null) {
        failManualRun(deps, db, runId, ['missing_credentials'])
        return
      }
      markManualRunRunning(db, runId)
      errors = await processRunGroups(deps, db, runId, classifier, controller, run)
      // A finished run never leaves an item looking as if it may still start.
      deferQueuedManualRunItems(db, runId)
      const current = readManualRun(db, runId)
      if (current === null) return
      finishManualRun(db, runId, {
        status: finalStatus(current, errors, controller.signal),
        at: deps.now().toISOString(),
        errors,
      })
    } catch {
      deferQueuedManualRunItems(db, runId)
      failManualRun(deps, db, runId, [...errors, 'unexpected_error'])
    } finally {
      db.close()
    }
  }

  return {
    start,
    restart,
    read,
    stop,
    /** Synthetic tests wait for background work without exposing this to the browser. */
    settled: async (runId: string) => jobs.get(runId)?.promise,
  }
}

async function processRunGroups(
  deps: TriageRunDependencies,
  db: DatabaseSync,
  runId: string,
  classifier: Classifier,
  controller: AbortController,
  run: TriageRunSnapshot,
) {
  const errors: string[] = []
  const groups = groupSelection(selectionForManualRun(db, runId))
  let remainingCalls = run.limits.maxJevCalls
  for (const group of groups) {
    if (controller.signal.aborted || manualRunStopRequested(db, runId)) break
    const summary = await runShadowTriageSelection(
      {
        reader: deps.reader,
        classify: classifier,
        db,
        now: () => deps.now().toISOString(),
        processId: deps.processId,
        isProcessAlive: deps.isProcessAlive,
        signal: controller.signal,
        stopRequested: () => manualRunStopRequested(db, runId),
        observer: {
          runStarted: (shadowRunId) => {
            linkShadowRun(db, runId, group.mailboxId, shadowRunId)
          },
          message: ({ mailboxId, messageId, status }) => {
            markManualRunItem(db, runId, mailboxId, messageId, status)
          },
        },
      },
      group,
      { maxJevCalls: Math.max(1, remainingCalls), jevConcurrency: 2 },
    )
    remainingCalls -= summary.classified + summary.providerFailures + summary.storeErrors
    if (summary.errorCode !== null) errors.push(summary.errorCode)
    if (manualRunStopRequested(db, runId)) break
    if (remainingCalls <= 0) controller.abort('budget_exhausted')
  }
  return errors
}

function finalStatus(
  run: TriageRunSnapshot,
  errors: readonly string[],
  signal: AbortSignal,
): Exclude<TriageRunStatus, 'queued' | 'running' | 'stopping' | 'interrupted'> {
  if (run.status === 'stopping') return 'stopped'
  if (signal.aborted && signal.reason !== 'budget_exhausted') return 'stopped'
  if (errors.length > 0 && run.counts.deferred === run.counts.selected) return 'failed'
  return run.counts.errors > 0 || run.counts.deferred > 0 || errors.length > 0
    ? 'partial'
    : 'completed'
}

function failManualRun(
  deps: TriageRunDependencies,
  db: DatabaseSync,
  runId: string,
  errors: string[],
) {
  finishManualRun(db, runId, { status: 'failed', at: deps.now().toISOString(), errors })
}

async function selectItems(
  deps: TriageRunDependencies,
  request: TriageRunStart,
  signal?: AbortSignal,
): Promise<
  | { status: 'ready'; label: string; items: readonly ManualRunSelection[] }
  | { status: 'blocked'; reason: 'stale_worklist' | 'empty_scope' | 'mailbox_unavailable' }
> {
  if (request.scope.kind === 'worklist') {
    const items = deps.worklist(request.scope.reading)
    if (items === null) return { status: 'blocked', reason: 'stale_worklist' }
    return items.length === 0
      ? { status: 'blocked', reason: 'empty_scope' }
      : { status: 'ready', label: 'Current worklist', items }
  }
  const mailbox = request.scope.mailbox
  const options = signal === undefined ? undefined : { signal }
  try {
    const access = (await deps.reader.listMailboxes(options)).find(
      (candidate) => candidate.canRead && candidate.mailbox.address === mailbox,
    )
    if (access === undefined) return { status: 'blocked', reason: 'mailbox_unavailable' }
    const listed = await deps.reader.listRecentEmails(
      { mailboxId: access.mailbox.id, limit: request.limits.maxMessages },
      options,
    )
    const items = listed.map((message) => ({
      mailboxId: access.mailbox.id,
      mailboxAddress: access.mailbox.address,
      messageId: message.messageId,
    }))
    return items.length === 0
      ? { status: 'blocked', reason: 'empty_scope' }
      : { status: 'ready', label: access.mailbox.address, items }
  } catch {
    return { status: 'blocked', reason: 'mailbox_unavailable' }
  }
}

function groupSelection(items: readonly ManualRunSelection[]) {
  const groups = new Map<string, ManualRunSelection[]>()
  for (const item of items) {
    const key = `${item.mailboxId}\u0000${item.mailboxAddress}`
    const group = groups.get(key) ?? []
    group.push(item)
    groups.set(key, group)
  }
  return [...groups.values()].map((items) => ({
    mailboxId: items[0]?.mailboxId ?? '',
    mailboxAddress: items[0]?.mailboxAddress ?? '',
    messageIds: items.map((item) => item.messageId),
  }))
}

function uniqueSelection(items: readonly ManualRunSelection[]) {
  const seen = new Set<string>()
  return items.filter((item) => {
    const key = `${item.mailboxId}\u0000${item.messageId}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

const safeEnabled = (enabled: () => boolean) => {
  try {
    return enabled()
  } catch {
    return false
  }
}

let production: ReturnType<typeof createTriageRunService> | undefined

function productionService() {
  production ??= createTriageRunService({
    reader: sparkMailReader(),
    classifier: () => {
      const config = readJevConfig(process.env)
      return config.status === 'configured'
        ? createJevClassifier(createSdkTransport({ apiKey: config.apiKey }))
        : null
    },
    open: () => {
      const path = readDatabasePath(process.env)
      mkdirSync(dirname(path), { recursive: true })
      return openDatabase(path)
    },
    worklist: worklistFor,
    enabled: () => process.env['JEV_MANUAL_RUNS_ENABLED'] === '1',
    now: () => new Date(),
    newId: randomUUID,
    processId: process.pid,
    isProcessAlive,
  })
  return production
}

export const startTriageRunOnServer = (request: TriageRunStart, signal?: AbortSignal) =>
  productionService().start(request, signal)
export const restartTriageRunOnServer = (request: TriageRunRestart) =>
  productionService().restart(request)
export const readTriageRunOnServer = (runId: string) => productionService().read(runId)
export const stopTriageRunOnServer = (runId: string) => productionService().stop(runId)
