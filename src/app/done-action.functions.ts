/** The browser's only route to server-owned Done approval and execution. */
import { createServerFn } from '@tanstack/react-start'
import { getRequest, getRequestIP, setResponseHeaders } from '@tanstack/react-start/server'
import {
  doneApprovalRequestSchema,
  doneExecutionRequestSchema,
  type DoneApprovalResult,
  type DoneExecutionResult,
} from './done-action'
import { approveDoneOnServer, doneRequestAllowed, executeDoneOnServer } from './done-action.server'

function context() {
  setResponseHeaders(new Headers({ 'Cache-Control': 'no-store' }))
  const request = getRequest()
  return { gate: doneRequestAllowed(getRequestIP(), request), signal: request.signal }
}

/** One explicit browser decision; the server chooses who and when. */
export const approveDoneAction = createServerFn({ method: 'POST' })
  .validator(doneApprovalRequestSchema)
  .handler(async ({ data }): Promise<DoneApprovalResult> => {
    const { gate, signal } = context()
    if (gate !== 'allowed') return { status: 'blocked', reason: gate }
    return approveDoneOnServer(data, signal)
  })

/** One execution request; the server rechecks its persisted approval. */
export const executeDoneAction = createServerFn({ method: 'POST' })
  .validator(doneExecutionRequestSchema)
  .handler(async ({ data }): Promise<DoneExecutionResult> => {
    const { gate } = context()
    if (gate !== 'allowed') return { status: 'blocked', reason: gate }
    return executeDoneOnServer(data)
  })
