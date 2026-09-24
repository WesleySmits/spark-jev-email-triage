/** Local browser boundary for explicit manual Jev runs. */
import { createServerFn } from '@tanstack/react-start'
import { getRequest, getRequestIP, setResponseHeaders } from '@tanstack/react-start/server'
import { isLoopback } from './live-inbox.server'
import {
  triageRunIdSchema,
  triageRunRestartSchema,
  triageRunStartSchema,
  type TriageRunReadResult,
  type TriageRunStartResult,
  type TriageRunStopResult,
} from './triage-run'
import {
  readTriageRunOnServer,
  restartTriageRunOnServer,
  startTriageRunOnServer,
  stopTriageRunOnServer,
} from './triage-runs.server'

function localRequest() {
  setResponseHeaders(new Headers({ 'Cache-Control': 'no-store' }))
  const request = getRequest()
  return { allowed: isLoopback(getRequestIP()), signal: request.signal }
}

/** The only browser operation that can start Jev work. */
export const startTriageRun = createServerFn({ method: 'POST' })
  .validator(triageRunStartSchema)
  .handler(async ({ data }): Promise<TriageRunStartResult> => {
    const { allowed, signal } = localRequest()
    return allowed
      ? startTriageRunOnServer(data, signal)
      : { status: 'blocked', reason: 'local_only' }
  })

/** Starts a new bounded run over the exact durable selection of an older one. */
export const restartTriageRun = createServerFn({ method: 'POST' })
  .validator(triageRunRestartSchema)
  .handler(({ data }): TriageRunStartResult => {
    const { allowed } = localRequest()
    return allowed ? restartTriageRunOnServer(data) : { status: 'blocked', reason: 'local_only' }
  })

/** Durable readback only: no provider read and no Jev call. */
export const readTriageRun = createServerFn({ method: 'POST' })
  .validator(triageRunIdSchema)
  .handler(({ data }): TriageRunReadResult => {
    const { allowed } = localRequest()
    return allowed ? readTriageRunOnServer(data.runId) : { status: 'unavailable' }
  })

/** Requests a cooperative stop; in-flight classifier reads settle first. */
export const stopTriageRun = createServerFn({ method: 'POST' })
  .validator(triageRunIdSchema)
  .handler(({ data }): TriageRunStopResult => {
    const { allowed } = localRequest()
    return allowed ? stopTriageRunOnServer(data.runId) : { status: 'unavailable' }
  })
