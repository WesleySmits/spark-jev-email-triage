import { describe, expect, it } from 'vitest'
import {
  failedCoverage,
  inboxCoverage,
  unscannedCoverage,
  viewCoverage,
  type CoverageScopeInput,
} from './inbox-coverage'

const mailbox = (change: Partial<CoverageScopeInput['mailboxes'][number]> = {}) => ({
  id: 'one@mail.example',
  label: 'one@mail.example',
  loaded: 0,
  bounded: false,
  ...change,
})

const scope = (change: Partial<CoverageScopeInput> = {}): CoverageScopeInput => ({
  view: 'unread',
  mailboxes: [mailbox()],
  failed: [],
  incomplete: [],
  readable: 1,
  loaded: 0,
  bounded: false,
  startedAt: '2026-09-24T09:42:00.000Z',
  refreshedAt: '2026-09-24T09:43:00.000Z',
  ...change,
})

describe('viewCoverage', () => {
  it('is complete only when every mailbox is exhausted without an error', () => {
    expect(viewCoverage(scope())).toMatchObject({
      result: 'complete',
      reasons: [],
      mailboxes: [{ result: 'complete' }],
    })
  })

  it('is incomplete while another page may exist', () => {
    expect(
      viewCoverage(scope({ mailboxes: [mailbox({ bounded: true })], bounded: true })),
    ).toMatchObject({ result: 'incomplete', reasons: ['more-pages'] })
  })

  it('keeps partial rows and distinguishes failed from incomplete mailboxes', () => {
    const failure = { id: 'one@mail.example', label: 'one@mail.example', reason: 'failed' as const }
    const later = {
      id: 'two@mail.example',
      label: 'two@mail.example',
      reason: 'malformed' as const,
    }
    const result = viewCoverage(
      scope({
        mailboxes: [mailbox(), mailbox({ id: later.id, label: later.label, loaded: 10 })],
        failed: [failure],
        incomplete: [later],
        loaded: 10,
        bounded: true,
      }),
    )
    expect(result).toMatchObject({
      result: 'incomplete',
      reasons: ['more-pages', 'mailbox-errors'],
      mailboxes: [{ result: 'failed' }, { result: 'incomplete', loaded: 10 }],
    })
  })

  it('is failed when every discovered mailbox failed', () => {
    const failure = { id: 'one@mail.example', label: 'one@mail.example', reason: 'failed' as const }
    expect(viewCoverage(scope({ failed: [failure] }))).toMatchObject({ result: 'failed' })
  })
})

describe('inboxCoverage', () => {
  it('starts both views explicitly incomplete and unscanned', () => {
    expect(unscannedCoverage('other')).toMatchObject({
      view: 'other',
      result: 'incomplete',
      reasons: ['not-scanned'],
    })
  })

  it('keeps a provider failure distinct from an empty view', () => {
    expect(
      failedCoverage('unread', '2026-09-24T09:42:00.000Z', '2026-09-24T09:42:01.000Z'),
    ).toMatchObject({ result: 'failed', reasons: ['provider-failure'], loaded: 0 })
  })

  it('never confirms zero after only one empty complete view', () => {
    expect(inboxCoverage(undefined, viewCoverage(scope()))).toMatchObject({
      zero: 'unknown',
      unread: { result: 'complete' },
      read: { reasons: ['not-scanned'] },
    })
  })

  it('confirms zero only when both views are complete, empty, error-free and scoped', () => {
    const unread = inboxCoverage(undefined, viewCoverage(scope()))
    const result = inboxCoverage(
      unread,
      viewCoverage(
        scope({
          view: 'other',
          startedAt: '2026-09-24T09:44:00.000Z',
          refreshedAt: '2026-09-24T09:45:00.000Z',
        }),
      ),
    )
    expect(result).toMatchObject({
      zero: 'confirmed',
      nonAtomic: true,
      startedAt: '2026-09-24T09:42:00.000Z',
      finishedAt: '2026-09-24T09:45:00.000Z',
    })
  })

  it('says not confirmed when either view contains a retained mailbox copy', () => {
    const unread = inboxCoverage(undefined, viewCoverage(scope()))
    const result = inboxCoverage(
      unread,
      viewCoverage(
        scope({
          view: 'other',
          mailboxes: [mailbox({ loaded: 1 })],
          loaded: 1,
        }),
      ),
    )
    expect(result.zero).toBe('not-confirmed')
  })

  it('does not confirm an empty zero-mailbox scope', () => {
    const empty = viewCoverage(scope({ mailboxes: [], readable: 0 }))
    expect(inboxCoverage(inboxCoverage(undefined, empty), { ...empty, view: 'other' }).zero).toBe(
      'unknown',
    )
  })
})
