/**
 * The review's only server boundary. It writes one review and nothing else:
 * no mailbox is read or changed here, and no classifier is called. The
 * client build replaces this module with an RPC stub, so the shadow store
 * stays on the server.
 */
import { createServerFn } from '@tanstack/react-start'
import { getRequestIP, setResponseHeaders } from '@tanstack/react-start/server'
import {
  deskReviewRequestSchema,
  type DeskReviewOutcome,
  type DeskReviewReadback,
} from './desk-review'
import { isLoopback } from './live-inbox.server'
import { reviewStatus, storeReview } from './reviews.server'

/**
 * Records one review of one stored classification. POST only, and only from
 * this computer: a request from anywhere else stores nothing. The answer is
 * a coarse status, so a refusal says why without naming what was reviewed.
 */
export const saveReview = createServerFn({ method: 'POST' })
  .validator(deskReviewRequestSchema)
  .handler(({ data }): DeskReviewOutcome => {
    setResponseHeaders(new Headers({ 'Cache-Control': 'no-store' }))
    return isLoopback(getRequestIP()) ? storeReview(data) : { status: 'failed' }
  })

/** Checks one Save id and its original payload in the local store. */
export const checkReview = createServerFn({ method: 'POST' })
  .validator(deskReviewRequestSchema)
  .handler(({ data }): DeskReviewReadback => {
    setResponseHeaders(new Headers({ 'Cache-Control': 'no-store' }))
    return isLoopback(getRequestIP()) ? reviewStatus(data) : { status: 'unavailable' }
  })
