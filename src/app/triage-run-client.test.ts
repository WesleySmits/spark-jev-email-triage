import { describe, expect, it } from 'vitest'
import { isActiveTriageRun, restoreTriageSession, saveTriageSession } from './triage-run-client'
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
