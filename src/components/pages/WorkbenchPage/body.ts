import type { MessageBody } from '../../../app/inbox'

/**
 * The body of the open message. Every request gets a number; only the
 * response to the latest one counts.
 *
 * - `idle`: no message is open.
 * - `loading`: request `request` for message `id` is on its way.
 * - `ready`: the text arrived.
 * - `error`: the message has no body (`missing`), or the provider failed.
 * - `stale`: what is held belongs to another message than the open one.
 *   It is never shown; the page asks for the open message instead.
 */
export type BodyState =
  | Readonly<{ status: 'idle' }>
  | Readonly<{ status: 'loading'; id: string; request: number }>
  | Readonly<{ status: 'ready'; id: string; request: number; text: string }>
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

/** Starts loading `id`, as a request newer than any before it. */
export function requestBody(state: BodyState, id: string): BodyState {
  return { status: 'loading', id, request: requestOf(state) + 1 }
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
  const { id } = state
  if (!outcome.ok || (outcome.body && outcome.body.id !== id)) {
    return { status: 'error', id, request, reason: 'provider' }
  }
  if (outcome.body === null) return { status: 'error', id, request, reason: 'missing' }
  return { status: 'ready', id, request, text: outcome.body.text }
}
