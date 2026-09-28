import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from 'react'
import { z } from 'zod'
import {
  triageRunRestartSchema,
  triageRunStartSchema,
  type TriageRunReadResult,
  type TriageRunRestart,
  type TriageRunSnapshot,
  type TriageRunStart,
  type TriageRunStartResult,
  type TriageRunStopResult,
} from './triage-run'

const storageKey = 'spark:jev-manual-run:v1'
const activeStatuses = new Set<TriageRunSnapshot['status']>(['queued', 'running', 'stopping'])

const pendingSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('start'), request: triageRunStartSchema }),
  z.strictObject({ kind: z.literal('restart'), request: triageRunRestartSchema }),
])

const sessionSchema = z.strictObject({
  version: z.literal(1),
  runId: z.uuid().optional(),
  pending: pendingSchema.optional(),
})

export type TriagePendingAction = z.infer<typeof pendingSchema>
export type TriageClientPhase =
  | 'restoring'
  | 'idle'
  | 'starting'
  | 'restarting'
  | 'reading'
  | 'stopping'
  | 'run'
  | 'uncertain'
  | 'blocked'
  | 'absent'
  | 'unavailable'

export type TriageClientState = Readonly<{
  phase: TriageClientPhase
  run?: TriageRunSnapshot | undefined
  /** Kept when readback is unavailable, so a later retry still names the same run. */
  runId?: string | undefined
  pending?: TriagePendingAction | undefined
  blockedReason?: Extract<TriageRunStartResult, { status: 'blocked' }>['reason'] | undefined
}>

interface TriageRunGateway {
  start: (request: TriageRunStart) => Promise<TriageRunStartResult>
  restart: (request: TriageRunRestart) => Promise<TriageRunStartResult>
  read: (runId: string) => Promise<TriageRunReadResult>
  stop: (runId: string) => Promise<TriageRunStopResult>
}

interface StorageLike {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
  removeItem: (key: string) => void
}

type SavedSession = z.infer<typeof sessionSchema>

/** Invalid or inaccessible browser state never invents a run. */
export function restoreTriageSession(storage: StorageLike | null): SavedSession | null {
  if (storage === null) return null
  try {
    const raw = storage.getItem(storageKey)
    if (raw === null) return null
    const parsed = sessionSchema.safeParse(JSON.parse(raw) as unknown)
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

export function saveTriageSession(storage: StorageLike | null, session: SavedSession | null): void {
  if (storage === null) return
  try {
    if (session === null || (session.runId === undefined && session.pending === undefined)) {
      storage.removeItem(storageKey)
    } else {
      storage.setItem(storageKey, JSON.stringify(session))
    }
  } catch {
    // Readback still works for this page when browser storage is unavailable.
  }
}

const browserStorage = (): StorageLike | null => {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

export const isActiveTriageRun = (run: TriageRunSnapshot | undefined) =>
  run !== undefined && activeStatuses.has(run.status)

type ControllerOptions = Readonly<{
  reading: string | undefined
  worklistSize?: number | undefined
  gateway: TriageRunGateway
  newRequestId?: (() => string) | undefined
  pollMs?: number | undefined
}>

export type BatchProgress = Readonly<{
  total: number
  processed: number
  calls: number
  maxCalls: number
  status: 'running' | 'completed' | 'paused'
}>

type BatchPlan = Readonly<{
  reading: string
  total: number
  offset: number
  calls: number
  maxCalls: number
  lastRunId?: string
}>

/** Advance only once per completed durable run; uncertainty and failures pause the sequence. */
export function nextTriageBatch(plan: BatchPlan, run: TriageRunSnapshot): BatchPlan | null {
  if (plan.lastRunId === run.runId || run.status !== 'completed') return null
  return {
    ...plan,
    offset: plan.offset + run.counts.selected,
    calls: plan.calls + run.cost.jevCalls,
    lastRunId: run.runId,
  }
}

const batchProgress = (plan: BatchPlan, status: BatchProgress['status']): BatchProgress => ({
  total: plan.total,
  processed: plan.offset,
  calls: plan.calls,
  maxCalls: plan.maxCalls,
  status,
})

function batchOutcome(plan: BatchPlan, run: TriageRunSnapshot) {
  if (plan.lastRunId === run.runId) return null
  const next = nextTriageBatch(plan, run)
  if (next === null) return { plan: null, progress: batchProgress(plan, 'paused') }
  const remaining = next.offset < next.total && next.calls < next.maxCalls
  return {
    plan: remaining ? next : null,
    progress: batchProgress(
      next,
      remaining ? 'running' : next.offset === next.total ? 'completed' : 'paused',
    ),
  }
}

function batchRequest(plan: BatchPlan, requestId: string): TriageRunStart {
  return {
    requestId,
    scope: { kind: 'worklist', reading: plan.reading, offset: plan.offset },
    limits: {
      maxMessages: Math.min(100, plan.total - plan.offset),
      maxJevCalls: Math.min(100, plan.maxCalls - plan.calls),
    },
  }
}

type StateSetter = Dispatch<SetStateAction<TriageClientState>>
type StateReference = RefObject<TriageClientState>
type SessionKeeper = (
  run: TriageRunSnapshot | undefined,
  pending?: TriagePendingAction,
  rememberedRunId?: string,
) => void

function useCurrentState(state: TriageClientState): StateReference {
  const reference = useRef(state)
  useEffect(() => {
    reference.current = state
  }, [state])
  return reference
}

function useSessionKeeper(storageRef: RefObject<StorageLike | null>): SessionKeeper {
  return (run, pending, rememberedRunId) => {
    const runId = run?.runId ?? rememberedRunId
    saveTriageSession(storageRef.current, {
      version: 1,
      ...(runId === undefined ? {} : { runId }),
      ...(pending === undefined ? {} : { pending }),
    })
  }
}

function useRunReader(
  gateway: TriageRunGateway,
  stateRef: StateReference,
  keep: SessionKeeper,
  setState: StateSetter,
) {
  const acceptRead = (
    result: TriageRunReadResult,
    previous: TriageRunSnapshot | undefined,
    runId: string,
  ) => {
    if (result.status === 'found') {
      keep(result.run)
      setState({ phase: 'run', run: result.run })
    } else {
      setState({
        phase: result.status === 'absent' ? 'absent' : 'unavailable',
        run: previous,
        runId,
      })
    }
  }

  return async (quiet = false) => {
    const current = stateRef.current
    const runId = current.run?.runId ?? current.runId
    if (runId === undefined || current.pending !== undefined) return
    if (!quiet) setState({ phase: 'reading', run: current.run, runId })
    try {
      acceptRead(await gateway.read(runId), current.run, runId)
    } catch {
      setState({ phase: 'unavailable', run: current.run, runId })
    }
  }
}

export function triageStateAfterReadback(
  saved: SavedSession,
  result: TriageRunReadResult,
): TriageClientState {
  if (saved.pending !== undefined) {
    return {
      phase: 'uncertain',
      ...(result.status === 'found' ? { run: result.run } : {}),
      runId: saved.runId,
      pending: saved.pending,
    }
  }
  if (result.status === 'found') {
    return { phase: 'run', run: result.run }
  }
  return {
    phase: result.status === 'absent' ? 'absent' : 'unavailable',
    runId: saved.runId,
  }
}

function useInitialReadback(
  gateway: TriageRunGateway,
  storageRef: RefObject<StorageLike | null>,
  setState: StateSetter,
) {
  useEffect(() => {
    let mounted = true
    storageRef.current = browserStorage()
    const saved = restoreTriageSession(storageRef.current)
    if (saved === null) {
      setState({ phase: 'idle' })
      return
    }
    if (saved.runId === undefined) {
      setState({ phase: 'uncertain', pending: saved.pending })
      return
    }
    setState({ phase: 'reading', runId: saved.runId, pending: saved.pending })
    void gateway
      .read(saved.runId)
      .then((result) => {
        if (mounted) setState(triageStateAfterReadback(saved, result))
      })
      .catch(() => {
        if (mounted) setState(triageStateAfterReadback(saved, { status: 'unavailable' }))
      })
    return () => {
      mounted = false
    }
  }, [gateway, setState, storageRef])
}

function useActiveRunPolling(
  state: TriageClientState,
  read: (quiet?: boolean) => Promise<void>,
  pollMs: number,
) {
  useEffect(() => {
    if (state.phase !== 'run' || !isActiveTriageRun(state.run)) return
    const timer = window.setTimeout(() => {
      void read(true)
    }, pollMs)
    return () => {
      window.clearTimeout(timer)
    }
  }, [pollMs, read, state.phase, state.run])
}

function usePendingExecutor(gateway: TriageRunGateway, keep: SessionKeeper, setState: StateSetter) {
  return async (
    pending: TriagePendingAction,
    previous: TriageRunSnapshot | undefined,
    previousRunId = previous?.runId,
  ) => {
    keep(previous, pending, previousRunId)
    setState({
      phase: pending.kind === 'start' ? 'starting' : 'restarting',
      run: previous,
      runId: previousRunId,
      pending,
    })
    try {
      const result =
        pending.kind === 'start'
          ? await gateway.start(pending.request)
          : await gateway.restart(pending.request)
      if (result.status === 'accepted') {
        keep(result.run)
        setState({ phase: 'run', run: result.run })
      } else {
        keep(previous, undefined, previousRunId)
        setState({
          phase: 'blocked',
          run: previous,
          runId: previousRunId,
          blockedReason: result.reason,
        })
      }
    } catch {
      setState({ phase: 'uncertain', run: previous, runId: previousRunId, pending })
    }
  }
}

type PendingExecutor = ReturnType<typeof usePendingExecutor>

function useRunCommands(
  reading: string | undefined,
  worklistSize: number,
  batchRef: RefObject<BatchPlan | null>,
  newRequestId: () => string,
  stateRef: StateReference,
  execute: PendingExecutor,
) {
  const start = (limits: TriageRunStart['limits']) => {
    if (reading === undefined) return Promise.resolve()
    const current = stateRef.current
    const plan: BatchPlan = {
      reading,
      total: Math.min(worklistSize, limits.maxMessages),
      offset: 0,
      calls: 0,
      maxCalls: Math.min(worklistSize, limits.maxJevCalls),
      ...(current.run && { lastRunId: current.run.runId }),
    }
    if (plan.total < 1 || plan.maxCalls < 1) return Promise.resolve()
    batchRef.current = plan
    const pending: TriagePendingAction = {
      kind: 'start',
      request: batchRequest(plan, newRequestId()),
    }
    return execute(pending, current.run, current.run?.runId ?? current.runId)
  }

  const restart = () => {
    const previous = stateRef.current.run
    if (previous === undefined || isActiveTriageRun(previous)) return Promise.resolve()
    return execute(
      {
        kind: 'restart',
        request: { requestId: newRequestId(), runId: previous.runId },
      },
      previous,
      previous.runId,
    )
  }

  const resume = () => {
    const current = stateRef.current
    return current.pending === undefined
      ? Promise.resolve()
      : execute(current.pending, current.run, current.run?.runId ?? current.runId)
  }

  return { start, restart, resume } as const
}

function useStopCommand(
  gateway: TriageRunGateway,
  stateRef: StateReference,
  keep: SessionKeeper,
  setState: StateSetter,
) {
  return async () => {
    const current = stateRef.current
    if (current.run === undefined || !isActiveTriageRun(current.run)) return
    setState({ phase: 'stopping', run: current.run })
    try {
      const result = await gateway.stop(current.run.runId)
      if (result.status === 'stopping' || result.status === 'already_finished') {
        keep(result.run)
        setState({ phase: 'run', run: result.run })
      } else {
        setState({
          phase: result.status === 'absent' ? 'absent' : 'unavailable',
          run: current.run,
          runId: current.run.runId,
        })
      }
    } catch {
      setState({ phase: 'unavailable', run: current.run, runId: current.run.runId })
    }
  }
}

function useBatchContinuation(
  state: TriageClientState,
  batchRef: RefObject<BatchPlan | null>,
  setBatch: Dispatch<SetStateAction<BatchProgress | undefined>>,
  execute: PendingExecutor,
  newRequestId: () => string,
) {
  useEffect(() => {
    const plan = batchRef.current
    const run = state.run
    if (plan === null || run === undefined) return
    if (['uncertain', 'unavailable', 'blocked', 'absent'].includes(state.phase)) {
      setBatch(batchProgress(plan, 'paused'))
      return
    }
    if (state.phase !== 'run' || isActiveTriageRun(run)) return
    const outcome = batchOutcome(plan, run)
    if (outcome === null) return
    batchRef.current = outcome.plan
    setBatch(outcome.progress)
    if (outcome.plan !== null) {
      void execute({ kind: 'start', request: batchRequest(outcome.plan, newRequestId()) }, run)
    }
  }, [batchRef, execute, newRequestId, setBatch, state.phase, state.run])
}

function useBatchActions(
  batchRef: RefObject<BatchPlan | null>,
  setBatch: Dispatch<SetStateAction<BatchProgress | undefined>>,
  worklistSize: number,
  start: (limits: TriageRunStart['limits']) => Promise<void>,
  stop: () => Promise<void>,
  restart: () => Promise<void>,
  storageRef: RefObject<StorageLike | null>,
  setState: StateSetter,
) {
  const startBatch = (limits: TriageRunStart['limits']) => {
    setBatch({
      total: Math.min(worklistSize, limits.maxMessages),
      processed: 0,
      calls: 0,
      maxCalls: Math.min(worklistSize, limits.maxJevCalls),
      status: 'running',
    })
    return start(limits)
  }
  const pause = () => {
    batchRef.current = null
    setBatch((previous) => previous && { ...previous, status: 'paused' })
  }
  return {
    startBatch,
    stopBatch: () => {
      pause()
      return stop()
    },
    restartBatch: () => {
      pause()
      return restart()
    },
    forget: () => {
      batchRef.current = null
      setBatch(undefined)
      saveTriageSession(storageRef.current, null)
      setState({ phase: 'idle' })
    },
  }
}

/**
 * Browser controller for one explicit manual run.
 *
 * Restoring and polling only call durable readback. A pending Start/Restart is
 * deliberately never resumed by an effect: after a lost response, the person
 * must press Resume, which replays the exact persisted request id.
 */
function useTriageRunCore({
  reading,
  worklistSize = 0,
  gateway,
  newRequestId = () => crypto.randomUUID(),
}: ControllerOptions) {
  const [state, setState] = useState<TriageClientState>({ phase: 'restoring' })
  const storageRef = useRef<StorageLike | null>(null)
  const stateRef = useCurrentState(state)
  const batchRef = useRef<BatchPlan | null>(null)
  const [batch, setBatch] = useState<BatchProgress>()
  const keep = useSessionKeeper(storageRef)
  const read = useRunReader(gateway, stateRef, keep, setState)
  const execute = usePendingExecutor(gateway, keep, setState)
  const { start, restart, resume } = useRunCommands(
    reading,
    worklistSize,
    batchRef,
    newRequestId,
    stateRef,
    execute,
  )
  const stop = useStopCommand(gateway, stateRef, keep, setState)
  return {
    state,
    setState,
    storageRef,
    batchRef,
    batch,
    setBatch,
    read,
    execute,
    start,
    restart,
    resume,
    stop,
    newRequestId,
    gateway,
    worklistSize,
  }
}

export function useTriageRunController(options: ControllerOptions) {
  const {
    state,
    setState,
    storageRef,
    batchRef,
    batch,
    setBatch,
    read,
    execute,
    start,
    restart,
    resume,
    stop,
    newRequestId,
    gateway,
    worklistSize,
  } = useTriageRunCore(options)
  const pollMs = options.pollMs ?? 1_000
  useInitialReadback(gateway, storageRef, setState)
  useActiveRunPolling(state, read, pollMs)
  useBatchContinuation(state, batchRef, setBatch, execute, newRequestId)

  const { startBatch, stopBatch, restartBatch, forget } = useBatchActions(
    batchRef,
    setBatch,
    worklistSize,
    start,
    stop,
    restart,
    storageRef,
    setState,
  )
  return {
    state,
    batch,
    start: startBatch,
    restart: restartBatch,
    resume,
    read: () => read(false),
    stop: stopBatch,
    forget,
  } as const
}
