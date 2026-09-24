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
  /** Optional, explicit browser-run cancellation and content-free progress. */
  signal?: AbortSignal | undefined
  /** Durable cancellation checked before provider reads and dispatches. */
  stopRequested?: (() => boolean) | undefined
  observer?: ShadowObserver | undefined
}

export type ShadowMessageStatus =
  | 'already_current'
  | 'duplicate'
  | 'classified'
  | 'provider_failure'
  | 'read_error'
  | 'store_error'
  | 'deferred'

export interface ShadowObserver {
  runStarted?: ((runId: number) => void) | undefined
  message?:
    | ((
        event: Readonly<{ mailboxId: string; messageId: string; status: ShadowMessageStatus }>,
      ) => void)
    | undefined
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

export interface ShadowSelection {
  mailboxId: string
  mailboxAddress: string
  messageIds: readonly string[]
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

/**
 * Runs the same versioned, idempotent pipeline over an already selected,
 * bounded set of mailbox copies. The caller owns how that selection was
 * obtained; the pipeline still verifies that the mailbox is currently
 * readable before it reads a thread or calls Jev.
 */
export async function runShadowTriageSelection(
  deps: ShadowDeps,
  selection: ShadowSelection,
  settings: Pick<Settings, 'maxJevCalls' | 'jevConcurrency'>,
): Promise<ShadowSummary> {
  const counts = emptyCounts()
  const summary = (outcome: RunOutcome): ShadowSummary => ({
    mode: deps.classify === null ? 'dry' : 'apply',
    ...counts,
    ...outcome,
  })
  const scope = await sparkStep(() => resolveSelectedScope(deps.reader, selection, deps.signal))
  if (!scope.ok) return summary(notStarted(scope.errorCode))
  if (scope.value === null) return summary(notStarted('mailbox_unavailable'))
  const listings = selection.messageIds.map((messageId) => ({ messageId }))
  counts.listed = listings.length
  if (deps.classify === null) {
    const threads = threadsToJudge(deps, scope.value, listings, counts)
    while (!(await threads.next()).done) {
      if (counts.wouldClassify < settings.maxJevCalls) counts.wouldClassify += 1
      else counts.deferred += 1
    }
    return summary({ runId: null, status: 'dry_run', errorCode: null, interruptedRuns: 0 })
  }
  return summary(
    await applySelectedRun(
      { ...deps, classify: deps.classify },
      scope.value,
      listings,
      settings,
      counts,
    ),
  )
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

async function resolveSelectedScope(
  reader: MailReader,
  selection: ShadowSelection,
  signal?: AbortSignal,
) {
  const mailbox = (await reader.listMailboxes(signal === undefined ? undefined : { signal })).find(
    (access) =>
      access.canRead &&
      access.mailbox.id === selection.mailboxId &&
      access.mailbox.address === selection.mailboxAddress,
  )
  if (mailbox === undefined) return null
  return {
    mailboxId: mailbox.mailbox.id,
    mailboxAddress: mailbox.mailbox.address,
    rubric: currentTriageRubric,
    model: jevModel,
  } satisfies Scope
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
  return appliedRun(deps, scope, counts, async (runId) => {
    const listed = await sparkStep(() => listRecent(deps.reader, scope, settings, counts))
    if (!listed.ok) return listed.errorCode
    await classifyAll(deps, scope, listed.value, settings, counts, runId)
    return null
  })
}

async function applySelectedRun(
  deps: ShadowDeps & { classify: NonNullable<ShadowDeps['classify']> },
  scope: Scope,
  listings: readonly Pick<Listing, 'messageId'>[],
  settings: Pick<Settings, 'maxJevCalls' | 'jevConcurrency'>,
  counts: Counts,
): Promise<RunOutcome> {
  return appliedRun(deps, scope, counts, async (runId) => {
    await classifyAll(deps, scope, listings, settings, counts, runId)
    return null
  })
}

async function appliedRun(
  deps: ShadowDeps & { classify: NonNullable<ShadowDeps['classify']> },
  scope: Scope,
  counts: Counts,
  work: (runId: number) => Promise<string | null>,
): Promise<RunOutcome> {
  const claim = beginRun(
    deps.db,
    { ...scope, startedAt: deps.now(), pid: deps.processId },
    deps.isProcessAlive,
  )
  if (claim.runId === null) return notStarted('run_in_progress')
  const { runId, interruptedRuns } = claim
  deps.observer?.runStarted?.(runId)
  const finish = (status: Exclude<RunStatus, 'running'>, errorCode: string | null = null) => {
    finishRun(deps.db, runId, { status, counts, errorCode, finishedAt: deps.now() })
    return { runId, status, errorCode, interruptedRuns }
  }
  try {
    const errorCode = await work(runId)
    if (errorCode !== null) return finish('failed', errorCode)
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
  listings: readonly Pick<Listing, 'messageId'>[],
  settings: Pick<Settings, 'maxJevCalls' | 'jevConcurrency'>,
  counts: Counts,
  runId: number,
) {
  const pool = createPool(settings.jevConcurrency)
  let calls = 0
  try {
    for await (const selected of threadsToJudge(deps, scope, listings, counts)) {
      if (calls >= settings.maxJevCalls || stopped(deps)) {
        counts.deferred += 1
        observe(deps, scope, selected.messageId, 'deferred')
        continue
      }
      calls += 1
      await pool.add(async () => {
        // `add` may wait for capacity. Check again after that wait so a stop
        // recorded by another process cannot leak one more provider call.
        if (stopped(deps)) {
          counts.deferred += 1
          observe(deps, scope, selected.messageId, 'deferred')
          return
        }
        const classification = await deps.classify(
          { thread: selected.thread, mailboxAddress: scope.mailboxAddress },
          deps.signal,
        )
        store(deps, scope, runId, selected, classification, counts)
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
  listings: readonly Pick<Listing, 'messageId'>[],
  counts: Counts,
): AsyncGenerator<Readonly<{ thread: Thread; messageId: string }>> {
  const seen = new Set<string>()
  for (const listing of listings) {
    const candidate = await classificationCandidate(deps, scope, listing.messageId, seen)
    if (candidate.status === 'ready') {
      yield { thread: candidate.thread, messageId: listing.messageId }
    } else {
      countCandidate(counts, candidate.status)
      observe(deps, scope, listing.messageId, candidate.status)
    }
  }
}

type Candidate =
  | Readonly<{ status: 'ready'; thread: Thread }>
  | Readonly<{ status: 'already_current' | 'duplicate' | 'read_error' | 'deferred' }>

async function classificationCandidate(
  deps: ShadowDeps,
  scope: Scope,
  messageId: string,
  seen: Set<string>,
): Promise<Candidate> {
  if (stopped(deps)) return { status: 'deferred' }
  if (isMessageJudged(deps.db, { ...scope, messageId })) return { status: 'already_current' }
  const thread = await readThread(deps.reader, scope.mailboxId, messageId, deps.signal)
  if (thread === null) return { status: 'read_error' }
  if (seen.has(thread.id)) return { status: 'duplicate' }
  seen.add(thread.id)
  return isThreadJudged(deps.db, {
    ...scope,
    threadId: thread.id,
    latestMessageId: latestId(thread),
  })
    ? { status: 'already_current' }
    : { status: 'ready', thread }
}

function countCandidate(counts: Counts, status: Exclude<Candidate['status'], 'ready'>): void {
  if (status === 'already_current') counts.skipped += 1
  if (status === 'duplicate') counts.duplicates += 1
  if (status === 'read_error') counts.readErrors += 1
  if (status === 'deferred') counts.deferred += 1
}

/** A thread that Spark cannot read or parse is skipped, not fatal. */
async function readThread(
  reader: MailReader,
  mailboxId: string,
  messageId: string,
  signal?: AbortSignal,
) {
  try {
    return await reader.readThread(
      { mailboxId, messageId },
      signal === undefined ? undefined : { signal },
    )
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
  selected: Readonly<{ thread: Thread; messageId: string }>,
  classification: JevClassification,
  counts: Counts,
) {
  const { thread, messageId } = selected
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
    observe(deps, scope, messageId, 'store_error')
    return
  }
  if (classification.status === 'provider_failure') {
    counts.providerFailures += 1
    observe(deps, scope, messageId, 'provider_failure')
  } else {
    counts.classified += 1
    observe(deps, scope, messageId, 'classified')
  }
  if (outcome.status === 'classified' && outcome.review === 'needs_review') counts.needsReview += 1
}

function observe(deps: ShadowDeps, scope: Scope, messageId: string, status: ShadowMessageStatus) {
  deps.observer?.message?.({ mailboxId: scope.mailboxId, messageId, status })
}

const stopped = (deps: ShadowDeps) =>
  deps.signal?.aborted === true || deps.stopRequested?.() === true

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
