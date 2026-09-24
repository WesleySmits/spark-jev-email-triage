/**
 * The live inbox's only server boundary. Both functions only read. The
 * client build replaces them with RPC stubs, so Spark stays on the server.
 */
import { createServerFn } from '@tanstack/react-start'
import { getRequest, getRequestIP, setResponseHeaders } from '@tanstack/react-start/server'
import { z } from 'zod'
import {
  bodyRequestSchema,
  inboxDiscoveryRequestSchema,
  inboxRefreshRequestSchema,
  type ClassifiedDiscovery,
  type ClassifiedInbox,
  type ClassifiedRefresh,
} from './live-inbox'
import { BodyUnavailableError, isLoopback } from './live-inbox.server'
import { deskDiscovery, deskReading, deskRefresh } from './review-desk.server'
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
export const getLiveInbox = createServerFn({ method: 'GET' })
  .validator(z.strictObject({ view: z.enum(['unread', 'other']), cursor: z.uuid().optional() }))
  .handler(async ({ data }): Promise<ClassifiedInbox> => {
    const { allowed, signal } = mailRequest()
    if (!allowed) return { status: 'unavailable', reason: 'local-only' }
    return deskReading({ signal }, data)
  })

/**
 * Searches listed sender/subject metadata. POST keeps the query out of URLs
 * and access logs; the provider reader's coarse log never receives it.
 */
export const searchLiveInbox = createServerFn({ method: 'POST' })
  .validator(inboxDiscoveryRequestSchema)
  .handler(async ({ data }): Promise<ClassifiedDiscovery> => {
    const { allowed, signal } = mailRequest()
    if (!allowed) return { status: 'unavailable', reason: 'local-only' }
    return deskDiscovery(data, { signal })
  })

/** Re-reads the already-loaded window; POST distinguishes it from a fresh list. */
export const refreshLiveInbox = createServerFn({ method: 'POST' })
  .validator(inboxRefreshRequestSchema)
  .handler(async ({ data }): Promise<ClassifiedRefresh> => {
    const { allowed, signal } = mailRequest()
    if (!allowed) return { status: 'unavailable', reason: 'local-only' }
    return deskRefresh(data, { signal })
  })

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
