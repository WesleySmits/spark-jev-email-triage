import { describe, expect, it } from 'vitest'
import {
  batchOutcome,
  isActiveTriageRun,
  nextTriageBatch,
  restoreCampaign,
  restoredCampaignProgress,
  restoreTriageSession,
  saveTriageSession,
  skipFailedReads,
  triageStateAfterReadback,
} from './triage-run-client'
import type { TriageRunSnapshot } from './triage-run'

function memoryStorage(initial?: string) {
  let value = initial ?? null
  return {
    getItem: () => value,
    setItem: (_key: string, next: string) => {
      value = next
    },
    removeItem: () => {
      value = null
    },
    value: () => value,
  }
}

const request = {
  requestId: 'e0143c04-0cc5-4d73-9a38-54b89225a8d0',
  scope: { kind: 'worklist' as const, reading: '96140040-fb6c-44b0-a671-2b02fc475f21' },
  limits: { maxMessages: 12, maxJevCalls: 8 },
}

describe('manual triage browser session', () => {
  it('round-trips the exact pending request id used to prevent a duplicate start', () => {
    const storage = memoryStorage()
    saveTriageSession(storage, { version: 1, pending: { kind: 'start', request } })

    expect(restoreTriageSession(storage)).toEqual({
      version: 1,
      pending: { kind: 'start', request },
    })
  })

  it('keeps a durable run id together with an uncertain restart', () => {
    const storage = memoryStorage()
    const runId = '58c6210a-76d3-4ae2-8910-a36a87005794'
    const pending = {
      kind: 'restart' as const,
      request: { requestId: request.requestId, runId },
    }
    saveTriageSession(storage, { version: 1, runId, pending })

    expect(restoreTriageSession(storage)).toEqual({ version: 1, runId, pending })
  })

  it.each(['absent', 'unavailable'] as const)(
    'keeps a pending restart resumable after %s readback',
    (status) => {
      const runId = '58c6210a-76d3-4ae2-8910-a36a87005794'
      const pending = {
        kind: 'restart' as const,
        request: { requestId: request.requestId, runId },
      }

      expect(triageStateAfterReadback({ version: 1, runId, pending }, { status })).toEqual({
        phase: 'uncertain',
        runId,
        pending,
      })
    },
  )

  it('fails closed for malformed or unavailable browser storage', () => {
    expect(restoreTriageSession(memoryStorage('{"version":1,"runId":"not-a-uuid"}'))).toBeNull()
    expect(
      restoreTriageSession({
        getItem: () => {
          throw new Error('blocked')
        },
        setItem: () => undefined,
        removeItem: () => undefined,
      }),
    ).toBeNull()
  })

  it('removes an empty session', () => {
    const storage = memoryStorage('{}')
    saveTriageSession(storage, null)
    expect(storage.value()).toBeNull()
  })
})

describe('active manual run status', () => {
  const run = (status: TriageRunSnapshot['status']) => ({ status }) as TriageRunSnapshot

  it.each(['queued', 'running', 'stopping'] as const)('treats %s as active', (status) => {
    expect(isActiveTriageRun(run(status))).toBe(true)
  })

  it.each(['stopped', 'completed', 'partial', 'failed', 'interrupted'] as const)(
    'treats %s as finished',
    (status) => {
      expect(isActiveTriageRun(run(status))).toBe(false)
    },
  )
})

describe('explicit full Inbox batch progression', () => {
  const plan = {
    reading: request.scope.reading,
    total: 205,
    offset: 0,
    calls: 0,
    maxCalls: 205,
    inputTokens: 0,
    classified: 0,
    alreadyCurrent: 0,
    duplicate: 0,
    readErrors: 0,
    otherErrors: 0,
    retryOffsets: [],
    retrying: false,
  }
  const run = {
    runId: '58c6210a-76d3-4ae2-8910-a36a87005794',
    status: 'completed',
    counts: { selected: 100 },
    cost: { jevCalls: 96, inputTokens: 10_000 },
  } as TriageRunSnapshot

  it('advances the immutable worklist offset once per completed run', () => {
    const next = nextTriageBatch(plan, run)
    expect(next).toMatchObject({ offset: 100, calls: 96, lastRunId: run.runId })
    if (next === null) throw new Error('Expected next batch')
    expect(nextTriageBatch(next, run)).toBeNull()
  })

  it.each(['queued', 'running', 'stopped', 'partial', 'failed', 'interrupted'] as const)(
    'does not advance after %s',
    (status) => {
      expect(nextTriageBatch(plan, { ...run, status })).toBeNull()
    },
  )

  it('counts a partial fourth batch and retries only its Spark read error', () => {
    const statuses = [
      ...Array.from({ length: 87 }, () => ({ status: 'classified' as const })),
      ...Array.from({ length: 10 }, () => ({ status: 'already_current' as const })),
      ...Array.from({ length: 2 }, () => ({ status: 'duplicate' as const })),
      { status: 'read_error' as const },
    ]
    const items = statuses.map((item, index) => ({
      ...item,
      mailbox: 'mailbox-1',
      messageId: String(index),
    }))
    const partial = {
      ...run,
      status: 'partial',
      counts: { ...run.counts, selected: 100 },
      cost: { ...run.cost, jevCalls: 87, inputTokens: 20_000 },
      items,
    } as TriageRunSnapshot
    const previous = { ...plan, total: 1_254, offset: 300, calls: 216 }
    const outcome = batchOutcome(previous, partial)
    expect(outcome).toMatchObject({
      progress: {
        processed: 400,
        calls: 303,
        classified: 87,
        alreadyCurrent: 10,
        duplicate: 2,
        readErrors: 1,
        status: 'paused',
      },
      plan: { offset: 400, retryOffsets: [399] },
      continueAutomatically: false,
    })
    if (outcome === null) throw new Error('Expected partial outcome')
    expect(batchOutcome(outcome.plan, partial)).toBeNull()
    const retry = {
      ...partial,
      runId: '0aa681c5-c3b3-430d-b93c-a5413341a091',
      status: 'completed',
      counts: { ...partial.counts, selected: 1 },
      cost: { ...partial.cost, jevCalls: 1, inputTokens: 300 },
      items: [{ mailbox: 'mailbox-1', messageId: '99', status: 'classified' }],
    } as TriageRunSnapshot
    const recovered = batchOutcome({ ...outcome.plan, retrying: true }, retry)
    expect(recovered).toMatchObject({
      plan: { offset: 400, retryOffsets: [], readErrors: 0 },
      progress: { processed: 400, readErrors: 0 },
    })
    const failedRetry = batchOutcome(
      { ...outcome.plan, retrying: true },
      {
        ...retry,
        status: 'partial',
        items: [{ mailbox: 'mailbox-1', messageId: '99', status: 'read_error' }],
      },
    )
    expect(failedRetry).toMatchObject({
      plan: { offset: 400, retryOffsets: [399], readErrors: 1 },
      progress: { processed: 400, readErrors: 1, status: 'paused' },
    })
    expect(skipFailedReads(outcome.plan)).toMatchObject({
      offset: 400,
      readErrors: 1,
      retryOffsets: [],
    })
  })

  it('restores campaign progress paused without a new start request', () => {
    const saved = restoreCampaign(
      memoryStorage(JSON.stringify({ ...plan, offset: 400, readErrors: 1, retryOffsets: [399] })),
    )
    expect(saved).not.toBeNull()
    if (saved === null) throw new Error('Expected saved campaign')
    expect(restoredCampaignProgress(saved)).toMatchObject({ processed: 400, status: 'paused' })
  })
})
