/**
 * The recorded work list's only server boundary. Recording writes one
 * decision to the local store and nothing else: no mailbox is read or
 * changed here and no classifier is called. The client build replaces this
 * module with an RPC stub, so the store stays on the server.
 */
import { createServerFn } from '@tanstack/react-start'
import { getRequestIP, setResponseHeaders } from '@tanstack/react-start/server'
import { isLoopback } from './live-inbox.server'
import { workDecisionRequestSchema, type RecordedWork, type WorkDecisionOutcome } from './open-work'
import { readRecordedWork, storeWorkDecision } from './open-work.server'

/** Every recorded copy's decisions, from this computer only, never cached. */
export const getRecordedWork = createServerFn({ method: 'GET' }).handler((): RecordedWork => {
  setResponseHeaders(new Headers({ 'Cache-Control': 'no-store' }))
  return isLoopback(getRequestIP()) ? readRecordedWork() : { status: 'unavailable' }
})

/**
 * Records one work decision. POST only, and only from this computer: a
 * request from anywhere else stores nothing.
 */
export const saveWorkDecision = createServerFn({ method: 'POST' })
  .validator(workDecisionRequestSchema)
  .handler(({ data }): WorkDecisionOutcome => {
    setResponseHeaders(new Headers({ 'Cache-Control': 'no-store' }))
    return isLoopback(getRequestIP()) ? storeWorkDecision(data) : { status: 'failed' }
  })
