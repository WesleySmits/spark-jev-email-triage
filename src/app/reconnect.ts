/**
 * Waits for Spark to come back, then reads the inbox once. Browser-safe and
 * framework-free: timers, visibility and the network state come in through
 * `ReconnectEnvironment`, so the rules can be tested with fake timers.
 *
 * Rules:
 * - Polling reasons (`missing`, `failed`, `unreachable`) check at once on
 *   start, then 10 seconds after each check settles, while the page is
 *   visible and online. Hidden or offline pauses the timer; visible, focus
 *   and online check at once.
 * - `malformed` checks only on Check now. `local-only` never checks.
 * - One request at a time, readiness or inbox read. A trigger meanwhile is
 *   ignored, not queued.
 * - Check now checks at once and restarts the 10 seconds.
 * - A ready answer stops polling and loads the inbox exactly once. If the
 *   page is still waiting after that, the next check is a full 10 seconds
 *   later.
 * - Stop cancels the timer and aborts a running check.
 */
import type { SparkReadiness, UnavailableReason } from './spark-readiness'

/** Why the page waits: a readiness reason, or the app server didn't answer. */
export type ConnectionReason = UnavailableReason | 'unreachable'

/** What runs now. `loading` is the one inbox read after a ready answer. */
export type ConnectionActivity = 'waiting' | 'checking' | 'loading'

export type ReconnectSnapshot = Readonly<{
  reason: ConnectionReason
  activity: ConnectionActivity
  /** When the last check settled. `null` before the first. */
  lastChecked: Date | null
  /** Unavailable answers in a row, and when the streak began. */
  failedChecks: number
  failingSince: Date | null
  /** The browser reports no network, so automatic checks wait. */
  offline: boolean
}>

export interface ReconnectEnvironment {
  visible: () => boolean
  online: () => boolean
  now: () => Date
  setTimeout: (run: () => void, ms: number) => unknown
  clearTimeout: (timer: unknown) => void
}

export interface ReconnectOptions {
  reason: ConnectionReason
  /** Asks the server whether Spark answers. Rejects when the server doesn't. */
  probe: (signal: AbortSignal) => Promise<SparkReadiness>
  /** Reads the inbox once, e.g. `router.invalidate()`. Settles when it is done. */
  load: () => Promise<void>
  environment: ReconnectEnvironment
  intervalMs?: number | undefined
}

/** Milliseconds from one settled check to the next. */
export const checkEveryMs = 10_000

/** Unavailable answers in a row, about 5 visible minutes, before the copy says so. */
export const persistentAfter = 30

const polling: ReadonlySet<ConnectionReason> = new Set(['missing', 'failed', 'unreachable'])

/** Whether a reason is checked again on its own. */
export const pollsFor = (reason: ConnectionReason) => polling.has(reason)

/** Whether Check now is offered: everywhere but `local-only`. */
export const checksOnRequest = (reason: ConnectionReason) => reason !== 'local-only'

export function createReconnect({
  reason,
  probe,
  load,
  environment: env,
  intervalMs = checkEveryMs,
}: ReconnectOptions) {
  let state: ReconnectSnapshot = {
    reason,
    activity: 'waiting',
    lastChecked: null,
    failedChecks: 0,
    failingSince: null,
    offline: false,
  }
  const listeners = new Set<() => void>()
  let calls = { probe, load }
  let started = false
  /** Moves on at every stop, so a check that outlives its start is ignored. */
  let generation = 0
  let timer: unknown
  let running: AbortController | undefined

  const set = (change: Partial<ReconnectSnapshot>) => {
    state = { ...state, ...change }
    for (const listener of listeners) listener()
  }
  /** Notes the network state, telling subscribers only when it changed. */
  const syncOffline = () => {
    if (state.offline === env.online()) set({ offline: !env.online() })
  }
  const canPoll = () => started && pollsFor(state.reason) && env.visible() && env.online()
  const clear = () => {
    if (timer !== undefined) env.clearTimeout(timer)
    timer = undefined
  }
  /** Starts the 10 seconds again, if this reason and page may poll now. */
  const schedule = () => {
    clear()
    if (!canPoll() || state.activity !== 'waiting') return
    timer = env.setTimeout(() => {
      timer = undefined
      void check()
    }, intervalMs)
  }

  const answered = (answer: SparkReadiness | null) => {
    const at = env.now()
    if (answer?.status === 'ready') {
      set({ activity: 'loading', lastChecked: at, failedChecks: 0, failingSince: null })
      return true
    }
    set({
      activity: 'waiting',
      reason: answer?.reason ?? 'unreachable',
      lastChecked: at,
      failedChecks: state.failedChecks + 1,
      failingSince: state.failingSince ?? at,
    })
    return false
  }

  async function check() {
    if (!started || state.activity !== 'waiting' || !checksOnRequest(state.reason)) return
    clear()
    const current = generation
    const controller = new AbortController()
    running = controller
    set({ activity: 'checking' })
    let answer: SparkReadiness | null
    try {
      answer = await calls.probe(controller.signal)
    } catch {
      answer = null
    }
    if (current !== generation) return
    running = undefined
    if (!answered(answer)) {
      schedule()
      return
    }
    try {
      await calls.load()
    } catch {
      // The page shows whatever the read found; waiting goes on below.
    }
    if (current !== generation) return
    // Still here, so the read found no mail: wait a full interval again.
    set({ activity: 'waiting' })
    schedule()
  }

  return {
    getSnapshot: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    /** Begins: checks at once when this reason polls and the page may. */
    start: () => {
      started = true
      syncOffline()
      if (canPoll()) void check()
    },
    /** Ends for good, e.g. on unmount: no timer, and a running check is aborted. */
    stop: () => {
      started = false
      generation += 1
      clear()
      running?.abort()
      running = undefined
      if (state.activity !== 'waiting') set({ activity: 'waiting' })
    },
    /** One check now, from Check now. Ignored while one runs. */
    checkNow: () => {
      void check()
    },
    /** The page became visible, focused or online: check now if this reason polls. */
    wake: () => {
      if (!started) return
      syncOffline()
      if (canPoll()) void check()
    },
    /** The page was hidden or went offline: no timer until it wakes. */
    pause: () => {
      syncOffline()
      clear()
    },
    /** The page learned a new reason, e.g. from the inbox read. */
    setReason: (next: ConnectionReason) => {
      if (next === state.reason) return
      set({ reason: next })
      if (!pollsFor(next)) clear()
      else if (timer === undefined) schedule()
    },
    /** Takes newer callbacks, e.g. from a re-render. The next call uses them. */
    update: (next: Pick<ReconnectOptions, 'probe' | 'load'>) => {
      calls = { probe: next.probe, load: next.load }
    },
  } as const
}
