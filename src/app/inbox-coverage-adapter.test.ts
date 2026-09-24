import { describe, expect, it } from 'vitest'
import type { InboxScope } from './live-inbox'
import { inboxCoverage } from './inbox-coverage'
import {
  coverageFromInboxScope,
  readWithCoverage,
  readWithStart,
  startedAtForRequest,
} from './inbox-coverage-adapter'

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
        '2026-09-24T09:42:00.000Z',
      ),
    ).toMatchObject({
      result: 'incomplete',
      reasons: ['more-pages', 'mailbox-errors'],
      incomplete: [failure],
    })
  })
})

describe('readWithCoverage', () => {
  it('turns a thrown read into failed coverage for the requested view', async () => {
    const result = await readWithCoverage(
      'other',
      '2026-09-24T09:42:00.000Z',
      () => Promise.reject(new Error('transport dropped before a promise result')),
      () => coverageFromInboxScope(scope({ view: 'other' }), '2026-09-24T09:42:00.000Z'),
      () => '2026-09-24T09:44:00.000Z',
    )

    expect(result.status).toBe('failed')
    expect(result.update).toMatchObject({
      view: 'other',
      result: 'failed',
      reasons: ['provider-failure'],
      startedAt: '2026-09-24T09:42:00.000Z',
      finishedAt: '2026-09-24T09:44:00.000Z',
    })
  })
})

describe('scan timing', () => {
  it('captures the initial start before the provider read begins', async () => {
    const order: string[] = []
    const result = await readWithStart(
      () => {
        order.push('read')
        return Promise.resolve('inbox')
      },
      () => {
        order.push('start')
        return '2026-09-24T09:40:00.000Z'
      },
    )

    expect(order).toEqual(['start', 'read'])
    expect(result).toEqual({ value: 'inbox', startedAt: '2026-09-24T09:40:00.000Z' })
  })

  it('keeps the first view start for a cursor continuation', () => {
    const first = coverageFromInboxScope(scope(), '2026-09-24T09:40:00.000Z')
    const coverage = inboxCoverage(undefined, first)

    expect(
      startedAtForRequest(
        coverage,
        { view: 'unread', cursor: 'next-page' },
        '2026-09-24T09:45:00.000Z',
      ),
    ).toBe('2026-09-24T09:40:00.000Z')
  })

  it('starts a new interval for refreshes and new view reads', () => {
    const first = coverageFromInboxScope(scope(), '2026-09-24T09:40:00.000Z')
    const coverage = inboxCoverage(undefined, first)
    const now = '2026-09-24T09:45:00.000Z'

    expect(startedAtForRequest(coverage, { view: 'unread' }, now)).toBe(now)
    expect(startedAtForRequest(coverage, { view: 'other' }, now)).toBe(now)
    expect(startedAtForRequest(coverage, { view: 'other', cursor: 'first-other-page' }, now)).toBe(
      now,
    )
  })
})
