import { describe, expect, it } from 'vitest'
import type { InboxRefreshSummary } from './live-inbox'
import { refreshNotice } from './refresh-notice'

const summary = (change: Partial<InboxRefreshSummary> = {}): InboxRefreshSummary => ({
  mailboxes: [],
  added: 0,
  removed: 0,
  updated: 0,
  readAt: '14:35',
  refreshedAt: '2026-09-24T12:35:00.000Z',
  ...change,
})

describe('refreshNotice', () => {
  it('names additions, read/Done removals and metadata updates separately', () => {
    expect(refreshNotice(summary({ added: 2, removed: 1, updated: 3 }))).toEqual({
      title: '2 new rows · 1 read/Done row removed · 3 rows updated',
      detail: 'Loaded window read at 14:35',
    })
  })

  it('does not turn a partial mailbox refresh into a claimed row change', () => {
    expect(
      refreshNotice(
        summary({
          mailboxes: [
            {
              id: 'one@mail.example',
              label: 'one@mail.example',
              pages: 1,
              added: 0,
              removed: 0,
              updated: 0,
              status: 'incomplete',
              reason: 'failed',
            },
          ],
        }),
      ),
    ).toEqual({
      title: 'No listed changes',
      detail: '1 mailbox incomplete · loaded window read at 14:35',
    })
  })
})
