import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { BodyLoader } from '../../../app/inbox'
import { bodyFor, idleBody, requestBody, settleBody, type BodyOutcome } from './body'

/**
 * The open message's body, loaded with `loadBody` only when it opens. The
 * previous request is aborted, and its response is ignored even if it
 * arrives anyway, so a slow body never replaces the one now open. `loadBody`
 * may change on every render; a load in flight keeps going.
 *
 * `reading` names the reading of the inbox the page is showing. Each request
 * records it, so the caller can tell a proof this reading made from one an
 * earlier reading made. A new reading on its own asks for nothing: the body
 * that was read stays, and no thread is read again.
 */
export function useMessageBody(loadBody: BodyLoader, openId: string | undefined, reading?: string) {
  const [held, setHeld] = useState(idleBody)
  const load = useRef(loadBody)
  useLayoutEffect(() => {
    load.current = loadBody
  })
  const body = bodyFor(held, openId)
  // Another message opened: ask for its body now, so the old one never shows.
  if (body.status === 'stale' && openId !== undefined) setHeld(requestBody(held, openId, reading))
  const id = held.status === 'loading' ? held.id : undefined
  const request = held.status === 'loading' ? held.request : undefined
  useEffect(() => {
    if (id === undefined || request === undefined) return
    const controller = new AbortController()
    const settle = (outcome: BodyOutcome) => {
      if (!controller.signal.aborted) setHeld((current) => settleBody(current, request, outcome))
    }
    void Promise.resolve()
      .then(() => load.current(id, { signal: controller.signal }))
      .then(
        (loaded) => {
          settle({ ok: true, body: loaded })
        },
        () => {
          settle({ ok: false })
        },
      )
    return () => {
      controller.abort()
    }
  }, [id, request])
  return {
    body,
    /** Asks for the open message's body again, e.g. after a provider failure. */
    retry: () => {
      if (openId !== undefined) setHeld((current) => requestBody(current, openId, reading))
    },
  } as const
}
