import { describe, expect, it } from 'vitest'
import { bodyFor, idleBody, requestBody, settleBody, type BodyState } from './body'

const text = (id: string, value: string) => ({ ok: true, body: { id, text: value } }) as const

describe('requestBody', () => {
  it('starts loading with a request newer than the last one', () => {
    const first = requestBody(idleBody, 'a', 'reading-1')
    expect(first).toEqual({ status: 'loading', id: 'a', request: 1, reading: 'reading-1' })
    expect(requestBody(first, 'b', 'reading-2')).toEqual({
      status: 'loading',
      id: 'b',
      request: 2,
      reading: 'reading-2',
    })
  })
})

describe('settleBody', () => {
  const loading = requestBody(idleBody, 'a', 'reading-1')

  it('shows the text of the current request', () => {
    expect(settleBody(loading, 1, text('a', 'Hello'))).toEqual({
      status: 'ready',
      id: 'a',
      request: 1,
      text: 'Hello',
      reading: 'reading-1',
    })
  })

  it('keeps what the read proved, and the reading its request ran under', () => {
    const classification = { state: 'none' } as const
    expect(
      settleBody(loading, 1, { ok: true, body: { id: 'a', text: 'Hello', classification } }),
    ).toEqual({
      status: 'ready',
      id: 'a',
      request: 1,
      text: 'Hello',
      reading: 'reading-1',
      classification,
    })
    expect(settleBody(loading, 1, text('a', 'Hello'))).not.toHaveProperty('classification')
  })

  it('reports a missing body and a provider failure apart', () => {
    expect(settleBody(loading, 1, { ok: true, body: null })).toMatchObject({
      status: 'error',
      reason: 'missing',
    })
    expect(settleBody(loading, 1, { ok: false })).toMatchObject({
      status: 'error',
      reason: 'provider',
    })
  })

  it('treats a body for another message as a provider failure', () => {
    expect(settleBody(loading, 1, text('b', 'Other'))).toMatchObject({
      status: 'error',
      id: 'a',
      reason: 'provider',
    })
  })

  it('ignores a stale response to an older request', () => {
    const newer = requestBody(loading, 'b', 'reading-1')
    expect(settleBody(newer, 1, text('a', 'Late'))).toBe(newer)
    expect(settleBody(newer, 1, { ok: false })).toBe(newer)
  })

  it('ignores a response once the request settled', () => {
    const ready = settleBody(loading, 1, text('a', 'Hello'))
    expect(settleBody(ready, 1, { ok: false })).toBe(ready)
  })
})

describe('bodyFor', () => {
  const ready: BodyState = settleBody(requestBody(idleBody, 'a', 'r'), 1, text('a', 'Hello'))

  it('is idle without an open message', () => {
    expect(bodyFor(ready, undefined)).toEqual({ status: 'idle' })
  })

  it('gives the held state for the open message', () => {
    expect(bodyFor(ready, 'a')).toBe(ready)
  })

  it('is stale when what is held belongs to another message', () => {
    expect(bodyFor(ready, 'b')).toEqual({ status: 'stale' })
    expect(bodyFor(idleBody, 'b')).toEqual({ status: 'stale' })
  })
})
