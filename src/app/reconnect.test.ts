import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  checkEveryMs,
  createReconnect,
  persistentAfter,
  type ConnectionReason,
  type ReconnectEnvironment,
} from './reconnect'
import type { SparkReadiness } from './spark-readiness'

const failed: SparkReadiness = { status: 'unavailable', reason: 'failed' }
const ready: SparkReadiness = { status: 'ready' }

/** A deferred answer the test settles by hand. */
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

type Setup = Readonly<{
  reason?: ConnectionReason
  answers?: (call: number) => SparkReadiness | Promise<SparkReadiness>
  load?: () => Promise<void>
}>

function setup({ reason = 'failed', answers = () => failed, load }: Setup = {}) {
  const page = { visible: true, online: true }
  const environment: ReconnectEnvironment = {
    visible: () => page.visible,
    online: () => page.online,
    now: () => new Date(),
    setTimeout: (run, ms) => setTimeout(run, ms),
    clearTimeout: (timer) => {
      clearTimeout(timer as ReturnType<typeof setTimeout>)
    },
  }
  const signals: AbortSignal[] = []
  const probe = vi.fn((signal: AbortSignal) => {
    signals.push(signal)
    return Promise.resolve(answers(probe.mock.calls.length))
  })
  const loader = vi.fn(load ?? (() => Promise.resolve()))
  const reconnect = createReconnect({ reason, probe, load: loader, environment })
  return { reconnect, probe, load: loader, page, signals }
}

/** Lets settled promises run their callbacks. */
const flush = () => vi.advanceTimersByTimeAsync(0)

beforeEach(() => {
  vi.useFakeTimers({ now: new Date('2026-09-22T09:41:00Z') })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('automatic checks', () => {
  it.each(['missing', 'failed', 'unreachable'] as const)(
    'checks %s at once, then every 10 seconds',
    async (reason) => {
      const { reconnect, probe } = setup({ reason })
      reconnect.start()
      expect(probe).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(checkEveryMs - 1)
      expect(probe).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(1)
      expect(probe).toHaveBeenCalledTimes(2)
      await vi.advanceTimersByTimeAsync(checkEveryMs * 3)
      expect(probe).toHaveBeenCalledTimes(5)
    },
  )

  it('waits 10 seconds after a check settles, not after it starts', async () => {
    const { reconnect, probe } = setup({
      answers: () =>
        new Promise((resolve) => {
          setTimeout(() => {
            resolve(failed)
          }, 3_000)
        }),
    })
    reconnect.start()
    await vi.advanceTimersByTimeAsync(3_000 + checkEveryMs - 1)
    expect(probe).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(probe).toHaveBeenCalledTimes(2)
  })

  it('keeps the 10 second cadence after a long failure and says since when', async () => {
    const { reconnect, probe } = setup()
    reconnect.start()
    const began = new Date()
    await vi.advanceTimersByTimeAsync(checkEveryMs * persistentAfter)
    expect(probe).toHaveBeenCalledTimes(persistentAfter + 1)
    const snapshot = reconnect.getSnapshot()
    expect(snapshot.failedChecks).toBe(persistentAfter + 1)
    expect(snapshot.failingSince).toEqual(began)
    expect(snapshot.lastChecked).toEqual(new Date())
  })

  it('treats a server that does not answer as unreachable and keeps checking', async () => {
    const { reconnect, probe } = setup({
      answers: () => Promise.reject(new Error('Failed to fetch')),
    })
    reconnect.start()
    await flush()
    expect(reconnect.getSnapshot().reason).toBe('unreachable')
    await vi.advanceTimersByTimeAsync(checkEveryMs)
    expect(probe).toHaveBeenCalledTimes(2)
  })

  it('takes on the reason the server gives', async () => {
    const { reconnect } = setup({
      answers: () => ({ status: 'unavailable', reason: 'missing' }),
    })
    reconnect.start()
    await flush()
    expect(reconnect.getSnapshot()).toMatchObject({ reason: 'missing', activity: 'waiting' })
  })
})

describe('reasons that do not poll', () => {
  it('never checks local-only, not even on request or wake', async () => {
    const { reconnect, probe } = setup({ reason: 'local-only' })
    reconnect.start()
    reconnect.checkNow()
    reconnect.wake()
    await vi.advanceTimersByTimeAsync(checkEveryMs * 10)
    expect(probe).not.toHaveBeenCalled()
  })

  it('stops for good when a check comes back local-only', async () => {
    const { reconnect, probe } = setup({
      answers: () => ({ status: 'unavailable', reason: 'local-only' }),
    })
    reconnect.start()
    await vi.advanceTimersByTimeAsync(checkEveryMs * 10)
    reconnect.checkNow()
    expect(probe).toHaveBeenCalledTimes(1)
  })

  it('checks malformed only on Check now', async () => {
    const { reconnect, probe } = setup({
      reason: 'malformed',
      answers: () => ({ status: 'unavailable', reason: 'malformed' }),
    })
    reconnect.start()
    reconnect.wake()
    await vi.advanceTimersByTimeAsync(checkEveryMs * 10)
    expect(probe).not.toHaveBeenCalled()
    reconnect.checkNow()
    await vi.advanceTimersByTimeAsync(checkEveryMs * 10)
    expect(probe).toHaveBeenCalledTimes(1)
  })

  it('polls again once a manual check finds a reason that polls', async () => {
    const { reconnect, probe } = setup({ reason: 'malformed' })
    reconnect.start()
    reconnect.checkNow()
    await vi.advanceTimersByTimeAsync(checkEveryMs)
    expect(probe).toHaveBeenCalledTimes(2)
  })

  it('stops the timer when the page learns a reason that does not poll', async () => {
    const { reconnect, probe } = setup()
    reconnect.start()
    await flush()
    reconnect.setReason('malformed')
    await vi.advanceTimersByTimeAsync(checkEveryMs * 5)
    expect(probe).toHaveBeenCalledTimes(1)
  })
})

describe('one request at a time', () => {
  it('ignores every trigger while a check runs', async () => {
    const pending = deferred<SparkReadiness>()
    const { reconnect, probe } = setup({ answers: () => pending.promise })
    reconnect.start()
    reconnect.checkNow()
    reconnect.checkNow()
    reconnect.wake()
    await vi.advanceTimersByTimeAsync(checkEveryMs * 5)
    expect(probe).toHaveBeenCalledTimes(1)
    expect(reconnect.getSnapshot().activity).toBe('checking')
    pending.resolve(failed)
    await flush()
    expect(reconnect.getSnapshot().activity).toBe('waiting')
  })

  it('Check now checks at once and restarts the 10 seconds', async () => {
    const { reconnect, probe } = setup()
    reconnect.start()
    await vi.advanceTimersByTimeAsync(6_000)
    reconnect.checkNow()
    expect(probe).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(checkEveryMs - 1)
    expect(probe).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(probe).toHaveBeenCalledTimes(3)
  })
})

describe('visibility and network', () => {
  it('does not check while hidden, and checks at once when shown', async () => {
    const { reconnect, probe, page } = setup()
    page.visible = false
    reconnect.start()
    await vi.advanceTimersByTimeAsync(checkEveryMs * 5)
    expect(probe).not.toHaveBeenCalled()
    page.visible = true
    reconnect.wake()
    expect(probe).toHaveBeenCalledTimes(1)
  })

  it('pauses the timer when hidden', async () => {
    const { reconnect, probe, page } = setup()
    reconnect.start()
    await flush()
    page.visible = false
    reconnect.pause()
    await vi.advanceTimersByTimeAsync(checkEveryMs * 5)
    expect(probe).toHaveBeenCalledTimes(1)
  })

  it('pauses offline, says so, and checks at once back online', async () => {
    const { reconnect, probe, page } = setup()
    reconnect.start()
    await flush()
    page.online = false
    reconnect.pause()
    expect(reconnect.getSnapshot().offline).toBe(true)
    await vi.advanceTimersByTimeAsync(checkEveryMs * 5)
    expect(probe).toHaveBeenCalledTimes(1)
    page.online = true
    reconnect.wake()
    expect(reconnect.getSnapshot().offline).toBe(false)
    expect(probe).toHaveBeenCalledTimes(2)
  })

  it('checks at once on focus, restarting the timer', async () => {
    const { reconnect, probe } = setup()
    reconnect.start()
    await vi.advanceTimersByTimeAsync(4_000)
    reconnect.wake()
    expect(probe).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(checkEveryMs - 1)
    expect(probe).toHaveBeenCalledTimes(2)
  })
})

describe('when Spark answers', () => {
  it('stops polling and loads the inbox exactly once, with no check during the read', async () => {
    const read = deferred<undefined>()
    const { reconnect, probe, load } = setup({ answers: () => ready, load: () => read.promise })
    reconnect.start()
    await flush()
    expect(load).toHaveBeenCalledTimes(1)
    expect(reconnect.getSnapshot().activity).toBe('loading')
    reconnect.checkNow()
    reconnect.wake()
    await vi.advanceTimersByTimeAsync(checkEveryMs * 5)
    expect(probe).toHaveBeenCalledTimes(1)
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('waits a full 10 seconds after a read that still found no mail', async () => {
    const { reconnect, probe, load } = setup({
      answers: (call) => (call === 1 ? ready : failed),
    })
    reconnect.start()
    await flush()
    expect(load).toHaveBeenCalledTimes(1)
    expect(reconnect.getSnapshot().activity).toBe('waiting')
    reconnect.wake()
    await vi.advanceTimersByTimeAsync(checkEveryMs - 1)
    expect(probe).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(probe).toHaveBeenCalledTimes(3)
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('does nothing more once stopped by the ready page', async () => {
    const read = deferred<undefined>()
    const { reconnect, probe, load } = setup({ answers: () => ready, load: () => read.promise })
    reconnect.start()
    await flush()
    reconnect.stop()
    read.resolve(undefined)
    await vi.advanceTimersByTimeAsync(checkEveryMs * 5)
    expect(probe).toHaveBeenCalledTimes(1)
    expect(load).toHaveBeenCalledTimes(1)
  })
})

describe('stop', () => {
  it('aborts a running check and ignores its late answer', async () => {
    const pending = deferred<SparkReadiness>()
    const { reconnect, probe, load, signals } = setup({ answers: () => pending.promise })
    reconnect.start()
    reconnect.stop()
    expect(signals[0]?.aborted).toBe(true)
    pending.resolve(ready)
    await vi.advanceTimersByTimeAsync(checkEveryMs * 5)
    expect(load).not.toHaveBeenCalled()
    expect(probe).toHaveBeenCalledTimes(1)
  })

  it('clears the timer', async () => {
    const { reconnect, probe } = setup()
    reconnect.start()
    await flush()
    reconnect.stop()
    await vi.advanceTimersByTimeAsync(checkEveryMs * 5)
    expect(probe).toHaveBeenCalledTimes(1)
  })

  it('can start again, as React does in development', async () => {
    const { reconnect, probe } = setup()
    reconnect.start()
    reconnect.stop()
    reconnect.start()
    expect(probe).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(checkEveryMs)
    expect(probe).toHaveBeenCalledTimes(3)
  })
})

it('tells subscribers about every change', async () => {
  const { reconnect } = setup()
  const listener = vi.fn()
  const unsubscribe = reconnect.subscribe(listener)
  reconnect.start()
  await flush()
  expect(listener).toHaveBeenCalled()
  unsubscribe()
  listener.mockClear()
  reconnect.checkNow()
  expect(listener).not.toHaveBeenCalled()
})
