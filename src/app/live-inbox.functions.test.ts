import { describe, expect, it } from 'vitest'
import {
  getLiveBody,
  getLiveInbox,
  refreshLiveInbox,
  searchLiveInbox,
} from './live-inbox.functions'

describe('live inbox server functions', () => {
  it('reads a body over POST, so its mailbox and id stay out of the URL', () => {
    expect(getLiveBody.method).toBe('POST')
  })

  it('lists over GET, which carries no request data', () => {
    expect(getLiveInbox.method).toBe('GET')
  })

  it('searches over POST, so private query text stays out of the URL', () => {
    expect(searchLiveInbox.method).toBe('POST')
  })

  it('refreshes over POST, distinct from a fresh GET list', () => {
    expect(refreshLiveInbox.method).toBe('POST')
  })
})
