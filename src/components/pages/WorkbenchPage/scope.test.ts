import { describe, expect, it } from 'vitest'
import { emptyScopeText, scopeText, syncScopeLabel, type QueueScope } from './scope'

// Synthetic figures only: nothing here reads a mailbox.
const mailbox = (id: string, loaded: number, bounded = false) => ({
  id,
  label: id,
  loaded,
  bounded,
})

const unread = (id: string, reason: 'missing' | 'failed' | 'malformed' = 'failed') => ({
  id,
  label: id,
  reason,
})

const scope = (change: Partial<QueueScope> = {}): QueueScope => ({
  mailboxes: [mailbox('one@mail.example', 4)],
  failed: [],
  readable: 1,
  mailboxLimit: 5,
  messageLimit: 10,
  loaded: 4,
  bounded: false,
  readAt: '09:42',
  refreshedAt: '2026-09-24T07:42:00.000Z',
  ...change,
})

/**
 * Three mailboxes with `failing` of them unread: the acceptance shape for a
 * reading that lost part of itself. The two that answered hold two rows each.
 */
const ofThree = (failing: readonly string[]): QueueScope => {
  const ids = ['one@mail.example', 'two@mail.example', 'three@mail.example']
  const loaded = ids.filter((id) => !failing.includes(id))
  return scope({
    mailboxes: ids.map((id) => mailbox(id, failing.includes(id) ? 0 : 2)),
    failed: failing.map((id) => unread(id)),
    readable: 3,
    loaded: loaded.length * 2,
  })
}

describe('scopeText', () => {
  it('counts what is loaded and says nothing was cut when no bound applied', () => {
    const text = scopeText(scope())

    expect(text.bounded).toBe(false)
    expect(text.summary).toBe('Loaded: 4 recent messages from 1 mailbox')
    expect(text.detail).toBe(
      'Every readable mailbox was loaded and none reached the 10 recent Inbox messages bound, ' +
        'so nothing was cut. Search and filters cover only loaded mail.',
    )
    expect(text.refreshed).toEqual({
      label: 'Last refreshed 09:42.',
      dateTime: '2026-09-24T07:42:00.000Z',
    })
  })

  it('never reads as a whole mailbox: the message bound says older mail was left out', () => {
    const text = scopeText(
      scope({
        mailboxes: [mailbox('one@mail.example', 10, true)],
        loaded: 10,
        bounded: true,
      }),
    )

    expect(text.bounded).toBe(true)
    expect(text.summary).toBe('Loaded: 10 recent messages from 1 mailbox')
    expect(text.detail).toContain(
      'Older mail was left out of 1 loaded mailbox (at most 10 recent Inbox messages each).',
    )
    expect(text.detail).toContain('Search and filters cover only loaded mail.')
    expect(text.refreshed.label).toBe('Last refreshed 09:42.')
  })

  it('does not call skipped mailboxes older mail: their newest mail is missing too', () => {
    // Two readable mailboxes were never read, and no loaded one hit the
    // message bound, so nothing about this reading is merely "older".
    const text = scopeText(
      scope({
        mailboxes: [mailbox('one@mail.example', 3), mailbox('two@mail.example', 2)],
        readable: 4,
        loaded: 5,
        bounded: true,
      }),
    )

    expect(text.bounded).toBe(true)
    expect(text.detail).toContain(
      '2 readable mailboxes were not read at all, so even the newest mail in them is missing ' +
        '(at most 5 mailboxes).',
    )
    expect(text.detail).not.toContain('Older mail')
  })

  it('says one skipped mailbox in the singular', () => {
    const text = scopeText(
      scope({
        mailboxes: [mailbox('one@mail.example', 3)],
        readable: 2,
        loaded: 3,
        bounded: true,
      }),
    )

    expect(text.detail).toContain(
      '1 readable mailbox was not read at all, so even the newest mail in it is missing',
    )
  })

  it('names both bounds when both left something out', () => {
    const text = scopeText(
      scope({
        mailboxes: [mailbox('one@mail.example', 10, true), mailbox('two@mail.example', 10, true)],
        readable: 7,
        loaded: 20,
        bounded: true,
      }),
    )

    expect(text.detail).toContain('5 readable mailboxes were not read at all')
    expect(text.detail).toContain('Older mail was left out of 2 loaded mailboxes')
  })

  it('names the mailboxes the bound left out rather than only the loaded ones', () => {
    const text = scopeText(
      scope({
        mailboxes: [mailbox('one@mail.example', 3), mailbox('two@mail.example', 2)],
        readable: 7,
        loaded: 5,
        bounded: true,
      }),
    )

    expect(text.summary).toBe('Loaded: 5 recent messages from 2 of 7 readable mailboxes')
  })

  it('pluralizes one message, one mailbox and one readable mailbox', () => {
    expect(scopeText(scope({ loaded: 1 })).summary).toBe('Loaded: 1 recent message from 1 mailbox')
    expect(
      scopeText(scope({ mailboxes: [], readable: 1, loaded: 0, bounded: false })).summary,
    ).toBe('Loaded: 0 recent messages from 0 of 1 readable mailbox')
  })
})

describe('scopeText with a mailbox that could not be read', () => {
  it('counts only the mailboxes that answered, so a failed one is not passed off as read', () => {
    const text = scopeText(ofThree(['two@mail.example']))

    expect(text.summary).toBe('Loaded: 4 recent messages from 2 of 3 readable mailboxes')
  })

  it('names what could not be read, with no guess about how much it holds', () => {
    const text = scopeText(ofThree(['two@mail.example']))

    expect(text.unread).toBe(
      '1 mailbox could not be read, so none of its mail is shown (two@mail.example). ' +
        'The rest of this reading was read without it. How much it holds is unknown. ' +
        'Refresh to try again.',
    )
  })

  it('says every mailbox failing differently from one mailbox failing', () => {
    const some = scopeText(ofThree(['two@mail.example']))
    const every = scopeText(ofThree(['one@mail.example', 'two@mail.example', 'three@mail.example']))

    expect(some.unread).toContain('1 mailbox could not be read')
    expect(every.unread).toContain('No listed mailbox could be read, so no mail is shown')
    expect(every.unread).not.toBe(some.unread)
  })

  it("withholds the bounds' all-clear, so a failure never reads as nothing missing", () => {
    const text = scopeText(ofThree(['two@mail.example']))

    expect(text.detail).not.toContain('nothing was cut')
    expect(text.detail).toContain('Search and filters cover only loaded mail')
  })

  it('keeps a bound and a failure apart, naming both when both applied', () => {
    const cut = { ...mailbox('one@mail.example', 10, true) }
    const text = scopeText(
      scope({
        mailboxes: [cut, mailbox('two@mail.example', 0)],
        failed: [unread('two@mail.example')],
        readable: 2,
        loaded: 10,
        bounded: true,
      }),
    )

    expect(text.detail).toContain('Older mail was left out of 1 loaded mailbox')
    expect(text.unread).toContain('1 mailbox could not be read')
    // A bound is not a failure: `bounded` still marks only the bound.
    expect(text.bounded).toBe(true)
  })

  it('says nothing about failure when every mailbox answered', () => {
    expect(scopeText(scope()).unread).toBeUndefined()
    expect(scopeText(ofThree([])).unread).toBeUndefined()
  })

  it('dates the reading it delivered, so what did arrive is not shown as older', () => {
    const text = scopeText(ofThree(['two@mail.example']))

    expect(text.refreshed).toEqual({
      label: 'Last refreshed 09:42.',
      dateTime: '2026-09-24T07:42:00.000Z',
    })
  })

  it('carries no mail: the failure names the mailbox and nothing in it', () => {
    const text = scopeText(ofThree(['two@mail.example']))

    expect(text.unread).toContain('two@mail.example')
    expect(text.unread).not.toMatch(/subject|sender|body/i)
  })
})

describe('syncScopeLabel', () => {
  it('dates the loaded selection, and says so plainly when nothing failed', () => {
    expect(syncScopeLabel(scope())).toBe('Loaded mail updated at 09:42 · read only')
  })

  it('says a mailbox could not be read, so Refresh reads as the retry', () => {
    expect(syncScopeLabel(ofThree(['two@mail.example']))).toBe(
      'Loaded mail updated at 09:42 · 1 mailbox could not be read · read only',
    )
    expect(syncScopeLabel(ofThree(['one@mail.example', 'two@mail.example']))).toContain(
      '2 mailboxes could not be read',
    )
  })
})

describe('emptyScopeText', () => {
  it('tells a reading that loaded nothing apart from a filter that matched nothing', () => {
    const nothing = emptyScopeText(scope({ mailboxes: [], loaded: 0 }))
    const filtered = emptyScopeText(scope())

    expect(nothing.title).toBe('No mail loaded')
    expect(filtered.title).toBe('No results in this filter')
    expect(nothing.title).not.toBe(filtered.title)
  })

  it('does not claim an empty reading proves the mailboxes are empty', () => {
    const { description } = emptyScopeText(scope({ mailboxes: [], readable: 3, loaded: 0 }))

    expect(description).toContain('0 of 3 readable mailboxes')
    expect(description).toContain('not proof that those mailboxes are empty')
  })

  it('says search only covers loaded mail when a filter matched nothing', () => {
    expect(emptyScopeText(scope()).description).toContain('Only loaded mail is searched')
  })

  it('falls back to the filter wording without a scope, as for fixtures', () => {
    expect(emptyScopeText(undefined).title).toBe('No results in this filter')
  })

  it('tells every mailbox failing from a reading that simply loaded nothing', () => {
    const failed = emptyScopeText(
      ofThree(['one@mail.example', 'two@mail.example', 'three@mail.example']),
    )
    const nothing = emptyScopeText(scope({ mailboxes: [], loaded: 0 }))

    expect(failed.title).toBe('No mailbox could be read')
    expect(failed.description).toContain('None of the 3 listed mailboxes answered')
    expect(failed.title).not.toBe(nothing.title)
  })

  it('does not turn every mailbox failing into a claim that they are empty', () => {
    const { description } = emptyScopeText(
      ofThree(['one@mail.example', 'two@mail.example', 'three@mail.example']),
    )

    expect(description).toContain('Nothing here says those mailboxes are empty')
    expect(description).toContain('refresh to read them again')
  })

  it('keeps the filter wording when a mailbox failed but loaded mail is there', () => {
    // Rows did load, so an empty queue here is the filter's doing.
    expect(emptyScopeText(ofThree(['two@mail.example'])).title).toBe('No results in this filter')
  })
})
