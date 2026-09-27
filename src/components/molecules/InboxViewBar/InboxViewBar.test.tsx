import { describe, expect, it, vi } from 'vitest'
import type { InboxScope } from '../../../app/live-inbox'
import { InboxLoadOlder } from './InboxViewBar'

const scope: InboxScope = {
  view: 'unread',
  pages: 1,
  cursor: 'next-page',
  mailboxes: [{ id: 'test@mail.example', label: 'Test', loaded: 10, bounded: true }],
  failed: [],
  incomplete: [],
  readable: 1,
  mailboxLimit: 10,
  messageLimit: 10,
  loaded: 10,
  bounded: true,
  readAt: '09:42',
  refreshedAt: '2026-09-24T09:42:00.000Z',
}

describe('InboxLoadOlder', () => {
  it('withholds base-inbox paging while search results are active', () => {
    const onChange = vi.fn()
    expect(InboxLoadOlder({ scope, loading: false, onChange, searchActive: true })).toBeNull()
    const footer = InboxLoadOlder({ scope, loading: false, onChange })
    expect(footer?.type).toBe('div')
  })
})
