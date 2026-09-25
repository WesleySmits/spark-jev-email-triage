import { describe, expect, it } from 'vitest'
import type { InboxRefreshSummary, InboxScope } from './live-inbox'
import { mailboxReachItems } from './mailbox-reach'

const scope: InboxScope = {
  view: 'unread',
  pages: 2,
  cursor: 'opaque',
  mailboxes: [
    { id: 'studio@mail.example', label: 'Studio', loaded: 19, pages: 2, bounded: true },
    { id: 'atelier@mail.example', label: 'Atelier', loaded: 8, pages: 1, bounded: false },
    { id: 'personal@mail.example', label: 'Personal', loaded: 0, pages: 0, bounded: false },
  ],
  failed: [{ id: 'personal@mail.example', label: 'Personal', reason: 'failed' }],
  incomplete: [{ id: 'atelier@mail.example', label: 'Atelier', reason: 'malformed' }],
  readable: 3,
  mailboxLimit: 3,
  messageLimit: 20,
  loaded: 27,
  bounded: true,
  readAt: '14:30',
  refreshedAt: '2026-09-24T12:30:00.000Z',
}

const mailboxes = [
  { id: 'studio@mail.example', label: 'Studio', account: 'studio' as const },
  { id: 'atelier@mail.example', label: 'Atelier', account: 'atelier' as const },
  { id: 'personal@mail.example', label: 'Personal', account: 'personal' as const },
]

describe('mailboxReachItems', () => {
  it('keeps reach, copies, failures and freshness attached to their mailbox', () => {
    expect(mailboxReachItems(scope, mailboxes)).toEqual([
      {
        id: 'studio@mail.example',
        label: 'Studio',
        account: 'studio',
        pages: 2,
        copies: 19,
        state: 'more',
        lastRead: { label: 'Last read 14:30', dateTime: '2026-09-24T12:30:00.000Z' },
      },
      {
        id: 'atelier@mail.example',
        label: 'Atelier',
        account: 'atelier',
        pages: 1,
        copies: 8,
        state: 'incomplete',
        lastRead: { label: 'Last read 14:30', dateTime: '2026-09-24T12:30:00.000Z' },
      },
      {
        id: 'personal@mail.example',
        label: 'Personal',
        account: 'personal',
        pages: 0,
        copies: 0,
        state: 'failed',
      },
    ])
  })

  it('maps controlled search reach without presenting matches as loaded copies', () => {
    const searched = mailboxReachItems(
      {
        view: 'unread',
        query: 'cedar',
        fields: ['sender', 'subject'],
        valuesMayBeTruncated: true,
        pageSize: 10,
        cursor: 'opaque',
        mailboxes: [
          {
            id: 'studio@mail.example',
            label: 'Studio',
            pages: 3,
            scanned: 28,
            matched: 2,
            bounded: true,
          },
        ],
        failed: [],
        incomplete: [],
        readable: 1,
        scanned: 28,
        matched: 2,
        bounded: true,
        searchedAt: '14:36',
        searchCompletedAt: '2026-09-24T12:36:00.000Z',
      },
      mailboxes,
    )

    expect(searched[0]).toMatchObject({
      pages: 3,
      copies: 28,
      state: 'more',
      lastRead: { label: 'Last searched 14:36', dateTime: '2026-09-24T12:36:00.000Z' },
    })
  })

  it('uses per-mailbox refresh depth and time without giving failures a read time', () => {
    const refresh: InboxRefreshSummary = {
      mailboxes: [
        {
          id: 'studio@mail.example',
          label: 'Studio',
          pages: 2,
          added: 1,
          removed: 1,
          updated: 0,
          status: 'refreshed',
          readAt: '14:35',
          refreshedAt: '2026-09-24T12:35:00.000Z',
        },
        {
          id: 'personal@mail.example',
          label: 'Personal',
          pages: 0,
          added: 0,
          removed: 0,
          updated: 0,
          status: 'failed',
          reason: 'failed',
        },
      ],
      added: 1,
      removed: 1,
      updated: 0,
      previousReadAt: '2026-09-24T12:30:00.000Z',
      readAt: '14:35',
      refreshedAt: '2026-09-24T12:35:00.000Z',
    }

    const items = mailboxReachItems(scope, mailboxes, refresh)

    expect(items[0]).toMatchObject({
      pages: 2,
      lastRead: { label: 'Last read 14:35', dateTime: '2026-09-24T12:35:00.000Z' },
    })
    expect(items[2]).not.toHaveProperty('lastRead')
  })
})
