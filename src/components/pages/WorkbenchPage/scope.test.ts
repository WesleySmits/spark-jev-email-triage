import { describe, expect, it } from 'vitest'
import { emptyScopeText, scopeText, type QueueScope } from './scope'

// Synthetic figures only: nothing here reads a mailbox.
const mailbox = (id: string, loaded: number, bounded = false) => ({
  id,
  label: id,
  loaded,
  bounded,
})

const scope = (change: Partial<QueueScope> = {}): QueueScope => ({
  mailboxes: [mailbox('one@mail.example', 4)],
  readable: 1,
  mailboxLimit: 5,
  messageLimit: 10,
  loaded: 4,
  bounded: false,
  readAt: '09:42',
  refreshedAt: '2026-09-24T07:42:00.000Z',
  ...change,
})

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
})
