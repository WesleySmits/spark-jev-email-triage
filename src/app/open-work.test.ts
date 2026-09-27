import { describe, expect, it } from 'vitest'
import {
  unscannedCoverage,
  type CoverageResult,
  type CoverageView,
  type InboxViewCoverage,
} from './inbox-coverage'
import { mailboxReachIn } from './open-work'

// Synthetic mail only: every address uses a reserved `.example` domain.
const studio = 'studio@mail.example'
const atelier = 'atelier@mail.example'
const gone = 'gone@mail.example'

const scope = {
  view: 'unread' as const,
  mailboxes: [
    { id: studio, label: studio, loaded: 3, bounded: false },
    { id: atelier, label: atelier, loaded: 0, bounded: false },
  ],
  failed: [{ id: atelier, label: atelier, reason: 'failed' as const }],
}

const view = (
  name: CoverageView,
  results: Readonly<Record<string, readonly [CoverageResult, number]>>,
): InboxViewCoverage => ({
  ...unscannedCoverage(name),
  mailboxes: Object.entries(results).map(([id, [result, loaded]]) => ({
    id,
    label: id,
    loaded,
    result,
  })),
})

describe('mailboxReachIn', () => {
  it('proves absence where the shown view read to the end and the other held nothing', () => {
    const reach = mailboxReachIn(scope, {
      unread: view('unread', { [studio]: ['complete', 3] }),
      read: view('other', { [studio]: ['complete', 0] }),
    })
    expect(reach(studio)).toBe('complete')
  })

  it('proves nothing while the other view holds mail the page has not loaded', () => {
    // The page holds unread rows only: a copy in the read view would
    // otherwise read as gone from the Inbox.
    expect(
      mailboxReachIn(scope, {
        unread: view('unread', { [studio]: ['complete', 3] }),
        read: view('other', { [studio]: ['complete', 2] }),
      })(studio),
    ).toBe('bounded')
  })

  it('reads the shown view as the one whose rows the page holds', () => {
    const coverage = {
      unread: view('unread', { [studio]: ['complete', 0] }),
      read: view('other', { [studio]: ['complete', 4] }),
    }
    expect(mailboxReachIn({ ...scope, view: 'other' }, coverage)(studio)).toBe('complete')
    expect(mailboxReachIn(scope, coverage)(studio)).toBe('bounded')
  })

  it('keeps a mailbox bounded while a view was cut or never scanned', () => {
    expect(
      mailboxReachIn(scope, {
        unread: view('unread', { [studio]: ['incomplete', 10] }),
        read: view('other', { [studio]: ['complete', 0] }),
      })(studio),
    ).toBe('bounded')
    expect(
      mailboxReachIn(scope, {
        unread: view('unread', { [studio]: ['complete', 3] }),
        read: view('other', {}),
      })(studio),
    ).toBe('bounded')
    expect(mailboxReachIn(scope, undefined)(studio)).toBe('bounded')
  })

  it('says unreadable where the reading or a scan failed for that mailbox', () => {
    expect(mailboxReachIn(scope, undefined)(atelier)).toBe('unreadable')
    expect(
      mailboxReachIn(scope, {
        unread: view('unread', { [studio]: ['complete', 3] }),
        read: view('other', { [studio]: ['failed', 0] }),
      })(studio),
    ).toBe('unreadable')
  })

  it('says absent for a mailbox this reading does not hold', () => {
    expect(mailboxReachIn(scope, undefined)(gone)).toBe('absent')
  })
})
