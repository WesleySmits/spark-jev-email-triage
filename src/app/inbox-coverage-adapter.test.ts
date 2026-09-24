import { describe, expect, it } from 'vitest'
import type { InboxScope } from './live-inbox'
import { coverageFromInboxScope } from './inbox-coverage-adapter'

const scope = (change: Partial<InboxScope> = {}): InboxScope => ({
  view: 'unread',
  pages: 1,
  cursor: 'opaque',
  mailboxes: [{ id: 'one@mail.example', label: 'one@mail.example', loaded: 0, bounded: false }],
  failed: [],
  incomplete: [],
  readable: 1,
  mailboxLimit: 10,
  messageLimit: 20,
  loaded: 0,
  bounded: false,
  readAt: '09:44',
  refreshedAt: '2026-09-24T09:44:00.000Z',
  ...change,
})

describe('coverageFromInboxScope', () => {
  it('preserves the provider scope while recording the command interval', () => {
    expect(coverageFromInboxScope(scope(), '2026-09-24T09:42:00.000Z')).toMatchObject({
      view: 'unread',
      result: 'complete',
      readable: 1,
      loaded: 0,
      startedAt: '2026-09-24T09:42:00.000Z',
      finishedAt: '2026-09-24T09:44:00.000Z',
      mailboxes: [{ id: 'one@mail.example', result: 'complete' }],
    })
  })

  it('keeps retained pages incomplete instead of presenting them as a complete view', () => {
    const failure = { id: 'one@mail.example', label: 'one@mail.example', reason: 'failed' as const }
    expect(
      coverageFromInboxScope(
        scope({
          mailboxes: [
            {
              id: 'one@mail.example',
              label: 'one@mail.example',
              loaded: 20,
              bounded: true,
            },
          ],
          incomplete: [failure],
          loaded: 20,
          bounded: true,
        }),
      ),
    ).toMatchObject({
      result: 'incomplete',
      reasons: ['more-pages', 'mailbox-errors'],
      incomplete: [failure],
    })
  })
})
