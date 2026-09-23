import type { RowReview } from '../../../app/desk-review'
import type { MessageBody } from '../../../app/inbox'
import type { StoredClassification } from '../../../domain/stored-classification'

/**
 * The body of the open message. Every request gets a number; only the
 * response to the latest one counts.
 *
 * A request also records the reading of the inbox it ran under, because what
 * the thread it read proves about a row is proof under that reading alone.
 * A later reading lists the mailbox again and the provider may have moved on
 * since; nothing here reads a thread again to find out, so an outlived proof
 * is no longer proof. The text it came with is still the text that was read,
 * and it stays.
 *
 * - `idle`: no message is open.
 * - `loading`: request `request` for message `id` is on its way.
 * - `ready`: the text arrived, with whatever the thread that read returned
 *   proved about the row's stored judgment, what a person decided about that
 *   judgment, and the reading it ran in.
 * - `error`: the message has no body (`missing`), or the provider failed.
 * - `stale`: what is held belongs to another message than the open one.
 *   It is never shown; the page asks for the open message instead.
 */
export type BodyState =
  | Readonly<{ status: 'idle' }>
  | Readonly<{ status: 'loading'; id: string; request: number; reading: string | undefined }>
  | Readonly<{
      status: 'ready'
      id: string
      request: number
      text: string
      /** The reading this request ran under, as the caller named it. */
      reading: string | undefined
      /**
       * What the thread this body was read from proves about the judgment
       * stored for the row. Absent when the read carried none, as fixtures do.
       */
      classification?: StoredClassification | undefined
      /**
       * What a person decided about that judgment, where anyone has. It
       * comes with the classification it decides and never without one.
       */
      review?: RowReview | undefined
    }>
  | Readonly<{
      status: 'error'
      id: string
      request: number
      reason: 'missing' | 'provider'
    }>
  | Readonly<{ status: 'stale' }>

/** What a load returned: the body, `null` for none, or a provider failure. */
export type BodyOutcome = Readonly<{ ok: true; body: MessageBody | null }> | Readonly<{ ok: false }>

export const idleBody: BodyState = { status: 'idle' }

const requestOf = (state: BodyState) => ('request' in state ? state.request : 0)

/**
 * Starts loading `id`, as a request newer than any before it, under the
 * reading of the inbox the page is showing now. What the read proves is
 * proof under that reading only; pass `undefined` when there is none.
 */
export function requestBody(state: BodyState, id: string, reading: string | undefined): BodyState {
  return { status: 'loading', id, request: requestOf(state) + 1, reading }
}

/**
 * The state for the open message: `idle` without one, `stale` when what is
 * held belongs to another message.
 */
export function bodyFor(state: BodyState, openId: string | undefined): BodyState {
  if (openId === undefined) return idleBody
  return 'id' in state && state.id === openId ? state : { status: 'stale' }
}

/**
 * Applies the response to `request`. A stale response, to an older request
 * or after the state moved on, changes nothing. A body for another message
 * counts as a provider failure and is never shown.
 */
export function settleBody(state: BodyState, request: number, outcome: BodyOutcome): BodyState {
  if (state.status !== 'loading' || state.request !== request) return state
  const { id, reading } = state
  if (!outcome.ok || (outcome.body && outcome.body.id !== id)) {
    return { status: 'error', id, request, reason: 'provider' }
  }
  if (outcome.body === null) return { status: 'error', id, request, reason: 'missing' }
  const { text, classification, review } = outcome.body
  return {
    status: 'ready',
    id,
    request,
    text,
    reading,
    ...(classification && { classification }),
    ...(review && { review }),
  }
}
