/**
 * The live inbox's only server boundary. Both functions only read. The
 * client build replaces them with RPC stubs, so Spark stays on the server.
 */
import { createServerFn } from '@tanstack/react-start'
import { getRequest, getRequestIP, setResponseHeaders } from '@tanstack/react-start/server'
import { bodyRequestSchema, type ClassifiedInbox } from './live-inbox'
import { BodyUnavailableError, isLoopback } from './live-inbox.server'
import { deskReading } from './review-desk.server'
import { sparkInbox } from './spark-inbox.server'

/**
 * Keeps mail out of every cache, and says whether this request may read
 * it: only one from this computer may. The request's signal stops the read
 * when the browser gives up on it.
 */
function mailRequest() {
  setResponseHeaders(new Headers({ 'Cache-Control': 'no-store' }))
  return { allowed: isLoopback(getRequestIP()), signal: getRequest().signal }
}

/**
 * Recent mail as bounded summaries, without bodies, with the stored judgment
 * of each row, or why it is unavailable. It reads only: no classifier is
 * called, so refreshing the page classifies nothing.
 */
export const getLiveInbox = createServerFn({ method: 'GET' }).handler(
  async (): Promise<ClassifiedInbox> => {
    const { allowed, signal } = mailRequest()
    if (!allowed) return { status: 'unavailable', reason: 'local-only' }
    return deskReading({ signal })
  },
)

/**
 * One listed message's plain-text body, or `null` when it has none. POST
 * only so the mailbox and id travel in the request body: a GET would put
 * them in the URL, where access logs keep them. It still only reads.
 */
export const getLiveBody = createServerFn({ method: 'POST' })
  .validator(bodyRequestSchema)
  .handler(async ({ data }) => {
    const { allowed, signal } = mailRequest()
    if (!allowed) throw new BodyUnavailableError()
    return sparkInbox().body(data, { signal })
  })
