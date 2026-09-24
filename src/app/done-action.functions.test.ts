import { describe, expect, it } from 'vitest'
import { approveDoneAction, executeDoneAction } from './done-action.functions'
import { doneRequestAllowed } from './done-action.server'

const request = (origin?: string, site?: string, url = 'http://127.0.0.1:3000/_server') =>
  new Request(url, {
    method: 'POST',
    headers: {
      ...(origin && { origin }),
      ...(site && { 'sec-fetch-site': site }),
    },
  })

describe('Done server function boundary', () => {
  it('uses POST for approval and execution', () => {
    expect(approveDoneAction.method).toBe('POST')
    expect(executeDoneAction.method).toBe('POST')
  })

  it('requires loopback, an exact Origin and same-origin fetch context', () => {
    expect(doneRequestAllowed('127.0.0.1', request('http://127.0.0.1:3000', 'same-origin'))).toBe(
      'allowed',
    )
    expect(doneRequestAllowed('192.0.2.1', request('http://127.0.0.1:3000'))).toBe('local_only')
    expect(doneRequestAllowed('127.0.0.1', request())).toBe('origin')
    expect(doneRequestAllowed('127.0.0.1', request('http://evil.example'))).toBe('origin')
    expect(doneRequestAllowed('127.0.0.1', request('http://127.0.0.1:3000', 'cross-site'))).toBe(
      'origin',
    )
    expect(
      doneRequestAllowed(
        '127.0.0.1',
        request('http://attacker.example', 'same-origin', 'http://attacker.example/_server'),
      ),
    ).toBe('origin')
  })
})
