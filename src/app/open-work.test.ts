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
  mailboxes: [
    { id: studio, label: studio, loaded: 3, bounded: false },
    { id: atelier, label: atelier, loaded: 0, bounded: false },
  ],
  failed: [{ id: atelier, label: atelier, reason: 'failed' as const }],
}

const view = (
  name: CoverageView,
  results: Readonly<Record<string, CoverageResult>>,
): InboxViewCoverage => ({
  ...unscannedCoverage(name),
  mailboxes: Object.entries(results).map(([id, result]) => ({ id, label: id, loaded: 0, result })),
})

describe('mailboxReachIn', () => {
  it('proves a mailbox complete only when both Inbox views read it to the end', () => {
    const reach = mailboxReachIn(scope, {
      unread: view('unread', { [studio]: 'complete' }),
      read: view('other', { [studio]: 'complete' }),
    })
    expect(reach(studio)).toBe('complete')
  })

  it('keeps a mailbox bounded while one view was cut or never scanned', () => {
    expect(
      mailboxReachIn(scope, {
        unread: view('unread', { [studio]: 'complete' }),
        read: view('other', { [studio]: 'incomplete' }),
      })(studio),
    ).toBe('bounded')
    expect(
      mailboxReachIn(scope, {
        unread: view('unread', { [studio]: 'complete' }),
        read: view('other', {}),
      })(studio),
    ).toBe('bounded')
    expect(mailboxReachIn(scope, undefined)(studio)).toBe('bounded')
  })

  it('says unreadable where the reading or a scan failed for that mailbox', () => {
    expect(mailboxReachIn(scope, undefined)(atelier)).toBe('unreadable')
    expect(
      mailboxReachIn(scope, {
        unread: view('unread', { [studio]: 'failed' }),
        read: view('other', { [studio]: 'complete' }),
      })(studio),
    ).toBe('unreadable')
  })

  it('says absent for a mailbox this reading does not hold', () => {
    expect(mailboxReachIn(scope, undefined)(gone)).toBe('absent')
  })
})
