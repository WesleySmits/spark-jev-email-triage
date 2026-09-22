import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MailboxAccess, MailReader } from '../domain/mail-reader'
import { SparkError } from '../spark/errors'
import {
  createSparkReadiness,
  probeTimeoutMs,
  readinessFor,
  reuseMs,
} from './spark-readiness.server'

// Synthetic mailboxes only: every address uses a reserved `.example` domain.
const mailboxes: MailboxAccess[] = [
  {
    mailbox: { id: 'one@mail.example', address: 'one@mail.example' },
    kind: 'account',
    canRead: true,
  },
  {
    mailbox: { id: 'team@mail.example', address: 'team@mail.example' },
    kind: 'shared_inbox',
    canRead: false,
  },
]

/** A reader whose mailbox listing the test controls. Lists and threads fail the test. */
function fakeReader(listMailboxes: MailReader['listMailboxes']) {
  const list = vi.fn(listMailboxes)
  const reader: MailReader = {
    listMailboxes: list,
    listRecentEmails: () => Promise.reject(new Error('A probe must not list mail')),
    readThread: () => Promise.reject(new Error('A probe must not read a thread')),
  }
  return Object.assign(reader, { list })
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('readiness probe', () => {
  it('says ready and nothing else when Spark lists its mailboxes', async () => {
    const reader = fakeReader(() => Promise.resolve(mailboxes))
    const answer = await createSparkReadiness({ reader }).probe()
    expect(answer).toStrictEqual({ status: 'ready' })
    expect(JSON.stringify(answer)).not.toMatch(/mail\.example|one|team/)
  })

  it('asks only for the mailbox list, never for mail', async () => {
    const reader = fakeReader(() => Promise.resolve(mailboxes))
    await createSparkReadiness({ reader }).probe()
    expect(reader.list).toHaveBeenCalledTimes(1)
  })

  it.each([
    [new SparkError('not_installed'), 'missing'],
    [new SparkError('exit_failure', null, 1), 'failed'],
    [new SparkError('timeout'), 'failed'],
    [new SparkError('malformed_output', 'accounts'), 'malformed'],
    [new Error('one@mail.example is signed out'), 'failed'],
  ] as const)('reports %s as %s, without its message', async (error, reason) => {
    const reader = fakeReader(() => Promise.reject(error))
    const answer = await createSparkReadiness({ reader }).probe()
    expect(answer).toStrictEqual({ status: 'unavailable', reason })
    expect(JSON.stringify(answer)).not.toContain('mail.example')
  })

  it('gives up after 5 seconds and aborts the call', async () => {
    let signal: AbortSignal | undefined
    const reader = fakeReader((options) => {
      signal = options?.signal
      return new Promise(() => undefined)
    })
    const answer = createSparkReadiness({ reader }).probe()
    await vi.advanceTimersByTimeAsync(probeTimeoutMs - 1)
    expect(signal?.aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await expect(answer).resolves.toStrictEqual({ status: 'unavailable', reason: 'failed' })
    expect(signal?.aborted).toBe(true)
  })

  it('shares one running probe between callers', async () => {
    let finish!: (value: MailboxAccess[]) => void
    const reader = fakeReader(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    const readiness = createSparkReadiness({ reader })
    const first = readiness.probe()
    const second = readiness.probe()
    finish(mailboxes)
    await expect(Promise.all([first, second])).resolves.toStrictEqual([
      { status: 'ready' },
      { status: 'ready' },
    ])
    expect(reader.list).toHaveBeenCalledTimes(1)
  })

  it('reuses a settled answer for 2 seconds, then asks again', async () => {
    const reader = fakeReader(() => Promise.reject(new SparkError('exit_failure')))
    const readiness = createSparkReadiness({ reader })
    await readiness.probe()
    await vi.advanceTimersByTimeAsync(reuseMs - 1)
    await readiness.probe()
    expect(reader.list).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    await readiness.probe()
    expect(reader.list).toHaveBeenCalledTimes(2)
  })
})

describe('readinessFor', () => {
  it('refuses another computer before Spark is asked anything', async () => {
    const readiness = vi.fn()
    await expect(readinessFor(false, readiness)).resolves.toStrictEqual({
      status: 'unavailable',
      reason: 'local-only',
    })
    expect(readiness).not.toHaveBeenCalled()
  })

  it('probes for this computer', async () => {
    const reader = fakeReader(() => Promise.resolve(mailboxes))
    const readiness = createSparkReadiness({ reader })
    await expect(readinessFor(true, () => readiness)).resolves.toStrictEqual({ status: 'ready' })
  })
})
