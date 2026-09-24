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
      'Nothing was cut by the at most 5 mailboxes and 10 recent Inbox messages each bound. ' +
        'Search and filters cover only loaded mail.',
    )
    expect(text.refreshed).toEqual({
      label: 'Last refreshed 09:42.',
      dateTime: '2026-09-24T07:42:00.000Z',
    })
  })

  it('never reads as a whole mailbox: a bounded reading says older mail was left out', () => {
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
      'Older mail was not loaded (at most 5 mailboxes and 10 recent Inbox messages each).',
    )
    expect(text.detail).toContain('Search and filters cover only loaded mail.')
    expect(text.refreshed.label).toBe('Last refreshed 09:42.')
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
