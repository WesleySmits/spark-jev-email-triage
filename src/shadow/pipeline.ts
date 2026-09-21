/**
 * Shadow triage: lists a bounded slice of recent mail through the read-only
 * Spark reader, classifies threads that have no judgment yet, and stores
 * each outcome locally. Nothing in Spark or any mailbox changes.
 *
 * - Spark calls are serial; Jev calls run up to `jevConcurrency` at once.
 * - A message already covered by a classified judgment for the current
 *   rubric and model is skipped without reading its thread. Reruns are
 *   idempotent; provider failures are retried.
 * - A run is `completed` only when every listed message was judged, skipped,
 *   or a duplicate. Any read, provider, or storage error, or a deferral for
 *   budget, makes it `partial`. A failed listing makes it `failed`, and a
 *   run left `running` by a stopped process becomes `interrupted`.
 */
import type { DatabaseSync } from 'node:sqlite'
import type { z } from 'zod'
import type { emailListingSchema, threadSchema } from '../domain/email'
import type { MailReader } from '../domain/mail-reader'
import { currentTriageRubric } from '../domain/triage'
import type { createJevClassifier, JevClassification } from '../jev/classifier'
import { resolveClassification } from '../jev/policy'
import { jevModel } from '../jev/questions'
import { buildTriageState } from '../jev/state'
import { SparkError } from '../spark/errors'
import type { ShadowConfig } from './config'
import {
  beginRun,
  finishRun,
  isMessageJudged,
  isThreadJudged,
  recordJudgment,
  type JudgedThread,
  type RunCounts,
  type RunStatus,
} from './store'

type Thread = z.infer<typeof threadSchema>
type Listing = z.infer<typeof emailListingSchema>

export interface ShadowDeps {
  reader: MailReader
  /** `null` for a dry run, which classifies and stores nothing. */
  classify: ReturnType<typeof createJevClassifier> | null
  db: DatabaseSync
  now: () => string
  /** This process, recorded on the run so another process can tell it is live. */
  processId: number
  isProcessAlive: (pid: number) => boolean
}

export interface ShadowSummary extends RunCounts {
  mode: 'dry' | 'apply'
  runId: number | null
  status: 'dry_run' | Exclude<RunStatus, 'running'>
  /** Dry runs only: threads a real run would send to Jev. */
  wouldClassify: number
  needsReview: number
  interruptedRuns: number
  /** A content-free code, such as `spark_timeout` or `run_in_progress`. */
  errorCode: string | null
}

type Settings = Pick<ShadowConfig, 'mailbox' | 'limit' | 'maxJevCalls' | 'jevConcurrency'>

interface Scope {
  mailboxId: string
  mailboxAddress: string
  rubric: string
  model: string
}

const emptyCounts = (): RunCounts & { wouldClassify: number } => ({
  listed: 0,
  skipped: 0,
  duplicates: 0,
  classified: 0,
  providerFailures: 0,
  readErrors: 0,
  storeErrors: 0,
  deferred: 0,
  needsReview: 0,
  wouldClassify: 0,
})

type Counts = ReturnType<typeof emptyCounts>

export async function runShadowTriage(
  deps: ShadowDeps,
  settings: Settings,
): Promise<ShadowSummary> {
  const mode = deps.classify === null ? 'dry' : 'apply'
  const counts = emptyCounts()
  const summary = (outcome: RunOutcome): ShadowSummary => ({ mode, ...counts, ...outcome })
  const scope = await sparkStep(() => resolveScope(deps.reader, settings.mailbox))
  if (!scope.ok) return summary(notStarted(scope.errorCode))
  if (scope.value === null) return summary(notStarted('mailbox_unavailable'))
  const outcome =
    deps.classify === null
      ? await dryRun(deps, scope.value, settings, counts)
      : await applyRun({ ...deps, classify: deps.classify }, scope.value, settings, counts)
  return summary(outcome)
}

interface RunOutcome {
  runId: number | null
  status: ShadowSummary['status']
  errorCode: string | null
  interruptedRuns: number
}

const notStarted = (errorCode: string): RunOutcome => ({
  runId: null,
  status: 'failed',
  errorCode,
  interruptedRuns: 0,
})

type StepResult<T> = { ok: true; value: T } | { ok: false; errorCode: string }

/** Runs one Spark step; a Spark failure becomes a content-free error code. */
async function sparkStep<T>(step: () => Promise<T>): Promise<StepResult<T>> {
  try {
    return { ok: true, value: await step() }
  } catch (error) {
    if (!(error instanceof SparkError)) throw error
    return { ok: false, errorCode: `spark_${error.code}` }
  }
}

const incomplete = (counts: Counts) =>
  counts.readErrors + counts.providerFailures + counts.storeErrors + counts.deferred > 0

/** `null` when Spark has no readable mailbox with this address. */
async function resolveScope(reader: MailReader, address: string): Promise<Scope | null> {
  const mailbox = (await reader.listMailboxes()).find(
    (access) => access.canRead && access.mailbox.address === address,
  )
  if (mailbox === undefined) return null
  return {
    mailboxId: mailbox.mailbox.id,
    mailboxAddress: mailbox.mailbox.address,
    rubric: currentTriageRubric,
    model: jevModel,
  }
}

async function dryRun(
  deps: ShadowDeps,
  scope: Scope,
  settings: Settings,
  counts: Counts,
): Promise<RunOutcome> {
  const listed = await sparkStep(() => listRecent(deps.reader, scope, settings, counts))
  if (!listed.ok) return notStarted(listed.errorCode)
  const threads = threadsToJudge(deps, scope, listed.value, counts)
  while (!(await threads.next()).done) {
    if (counts.wouldClassify < settings.maxJevCalls) counts.wouldClassify += 1
    else counts.deferred += 1
  }
  return { runId: null, status: 'dry_run', errorCode: null, interruptedRuns: 0 }
}

/** Records the run from start to finish; a run is never left `running`. */
async function applyRun(
  deps: ShadowDeps & { classify: NonNullable<ShadowDeps['classify']> },
  scope: Scope,
  settings: Settings,
  counts: Counts,
): Promise<RunOutcome> {
  const claim = beginRun(
    deps.db,
    { ...scope, startedAt: deps.now(), pid: deps.processId },
    deps.isProcessAlive,
  )
  if (claim.runId === null) return notStarted('run_in_progress')
  const { runId, interruptedRuns } = claim
  const finish = (status: Exclude<RunStatus, 'running'>, errorCode: string | null = null) => {
    finishRun(deps.db, runId, { status, counts, errorCode, finishedAt: deps.now() })
    return { runId, status, errorCode, interruptedRuns }
  }
  try {
    const listed = await sparkStep(() => listRecent(deps.reader, scope, settings, counts))
    if (!listed.ok) return finish('failed', listed.errorCode)
    await classifyAll(deps, scope, listed.value, settings, counts, runId)
  } catch (error) {
    finish('failed', 'unexpected_error')
    throw error
  }
  return finish(incomplete(counts) ? 'partial' : 'completed')
}

async function listRecent(reader: MailReader, scope: Scope, settings: Settings, counts: Counts) {
  const listings = await reader.listRecentEmails({
    mailboxId: scope.mailboxId,
    limit: settings.limit,
  })
  counts.listed = listings.length
  return listings
}

async function classifyAll(
  deps: ShadowDeps & { classify: NonNullable<ShadowDeps['classify']> },
  scope: Scope,
  listings: Listing[],
  settings: Settings,
  counts: Counts,
  runId: number,
) {
  const pool = createPool(settings.jevConcurrency)
  let calls = 0
  try {
    for await (const thread of threadsToJudge(deps, scope, listings, counts)) {
      if (calls >= settings.maxJevCalls) {
        counts.deferred += 1
        continue
      }
      calls += 1
      await pool.add(async () => {
        const classification = await deps.classify({ thread, mailboxAddress: scope.mailboxAddress })
        store(deps, scope, runId, thread, classification, counts)
      })
    }
  } finally {
    // Nothing may still be writing when the caller finishes the run.
    await pool.settled()
  }
  pool.rethrow()
}

/**
 * Yields each thread that still needs a judgment, reading threads one at a
 * time. Counts skips, duplicates, and read errors as it goes.
 */
async function* threadsToJudge(
  deps: ShadowDeps,
  scope: Scope,
  listings: Listing[],
  counts: Counts,
): AsyncGenerator<Thread> {
  const seen = new Set<string>()
  for (const listing of listings) {
    if (isMessageJudged(deps.db, { ...scope, messageId: listing.messageId })) {
      counts.skipped += 1
      continue
    }
    const thread = await readThread(deps.reader, scope.mailboxId, listing.messageId)
    if (thread === null) {
      counts.readErrors += 1
    } else if (seen.has(thread.id)) {
      counts.duplicates += 1
    } else {
      seen.add(thread.id)
      if (
        isThreadJudged(deps.db, {
          ...scope,
          threadId: thread.id,
          latestMessageId: latestId(thread),
        })
      ) {
        counts.skipped += 1
      } else {
        yield thread
      }
    }
  }
}

/** A thread that Spark cannot read or parse is skipped, not fatal. */
async function readThread(reader: MailReader, mailboxId: string, messageId: string) {
  try {
    return await reader.readThread({ mailboxId, messageId })
  } catch (error) {
    if (error instanceof SparkError) return null
    throw error
  }
}

const latestId = (thread: Thread) => thread.messages.at(-1)?.id ?? thread.id

function store(
  deps: ShadowDeps,
  scope: Scope,
  runId: number,
  thread: Thread,
  classification: JevClassification,
  counts: Counts,
) {
  const outcome = resolveClassification(classification)
  try {
    recordJudgment(deps.db, {
      runId,
      mailboxId: scope.mailboxId,
      thread: judgedThread(thread, scope.mailboxAddress),
      classification,
      outcome,
      judgedAt: deps.now(),
    })
  } catch (error) {
    if (!isSqliteError(error)) throw error
    counts.storeErrors += 1
    return
  }
  if (classification.status === 'provider_failure') counts.providerFailures += 1
  else counts.classified += 1
  if (outcome.status === 'classified' && outcome.review === 'needs_review') counts.needsReview += 1
}

/** Display fields come from the same scrubbed state Jev received. */
function judgedThread(thread: Thread, mailboxAddress: string): JudgedThread {
  const state = buildTriageState(thread, mailboxAddress).email_thread
  const [latest] = state.messages.slice(-1)
  if (latest === undefined) throw new Error('A thread has at least one message')
  return {
    id: thread.id,
    latestMessageId: latestId(thread),
    messageIds: thread.messages.map((message) => message.id),
    subject: state.subject,
    senderAddress: latest.sender.address,
    senderName: latest.sender.name,
  }
}

const isSqliteError = (error: unknown) =>
  error instanceof Error && 'code' in error && error.code === 'ERR_SQLITE_ERROR'

/**
 * Runs at most `size` tasks at once. The first task failure is kept and
 * rethrown: by `add`, so no new task starts, and by `rethrow` once every
 * running task has settled.
 */
function createPool(size: number) {
  const running = new Set<Promise<void>>()
  let failure: { error: unknown } | null = null
  const rethrow = () => {
    if (failure !== null) throw failure.error
  }
  return {
    async add(task: () => Promise<void>) {
      while (running.size >= size) await Promise.race(running)
      rethrow()
      const promise: Promise<void> = task()
        .catch((error: unknown) => {
          failure ??= { error }
        })
        .finally(() => running.delete(promise))
      running.add(promise)
    },
    settled: async () => {
      await Promise.all(running)
    },
    rethrow,
  }
}
