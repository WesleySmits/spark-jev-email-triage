import { describe, expect, it, vi } from 'vitest'
import type { InboxSummary } from './inbox'
import { bodyRequestSchema, liveBodyLoader } from './live-inbox'

const summary = (messageId: string, mailbox: string): InboxSummary => ({
  id: `${mailbox} copy of ${messageId}`,
  messageId,
  workflow: 'inbox',
  mailbox,
  sender: 'Sample Sender',
  time: '09:00',
  subject: `Subject ${messageId}`,
  snippet: '',
  account: { marker: 'studio', label: mailbox },
  status: { label: 'Not triaged', tone: 'neutral' },
})

describe('bodyRequestSchema', () => {
  it('accepts one message id in a mailbox, keeping the mailbox as listed', () => {
    expect(bodyRequestSchema.parse({ mailbox: 'Ops@Mail.example', id: '4001' })).toEqual({
      mailbox: 'Ops@Mail.example',
      id: '4001',
    })
  })

  it.each([
    { mailbox: 'ops@mail.example', id: '0' },
    { mailbox: 'ops@mail.example', id: '--help' },
    { mailbox: 'ops@mail.example', id: '1 2' },
    { mailbox: 'ops@mail.example', id: '1'.repeat(20) },
    { mailbox: '-ops', id: '1' },
    { mailbox: 'ops@mail.example', id: '1', body: 'x' },
    { mailbox: 'ops@mail.example' },
  ])('rejects %j', (input) => {
    expect(bodyRequestSchema.safeParse(input).success).toBe(false)
  })
})

describe('liveBodyLoader', () => {
  it('carries the selected pages for a cold server recheck', async () => {
    const fetchBody = vi.fn(() => Promise.resolve(null))
    const row = summary('31', 'one@mail.example')
    await liveBodyLoader([row], fetchBody, { view: 'unread', pages: 2 })(row.id, {
      signal: new AbortController().signal,
    })
    expect(fetchBody).toHaveBeenCalledWith(
      { mailbox: 'one@mail.example', id: '31', selection: { view: 'unread', pages: 2 } },
      expect.any(AbortSignal),
    )
  })
  const messages = [
    summary('11', 'one@mail.example'),
    summary('21', 'two@mail.example'),
    // The same message id as an alias copy in another mailbox.
    summary('11', 'two@mail.example'),
  ]

  it("asks for one message in the mailbox its summary names, with the page's signal", async () => {
    const row = 'two@mail.example copy of 21'
    const fetchBody = vi.fn(() => Promise.resolve({ id: row, text: 'Hello' }))
    const { signal } = new AbortController()

    await expect(liveBodyLoader(messages, fetchBody)(row, { signal })).resolves.toEqual({
      id: row,
      text: 'Hello',
    })
    expect(fetchBody).toHaveBeenCalledExactlyOnceWith(
      { mailbox: 'two@mail.example', id: '21' },
      signal,
    )
  })

  it('asks for each copy of one message id through its own mailbox', async () => {
    const fetchBody = vi.fn(() => Promise.resolve(null))
    const { signal } = new AbortController()
    const load = liveBodyLoader(messages, fetchBody)

    await load('two@mail.example copy of 11', { signal })
    await load('one@mail.example copy of 11', { signal })

    expect(fetchBody.mock.calls).toEqual([
      [{ mailbox: 'two@mail.example', id: '11' }, signal],
      [{ mailbox: 'one@mail.example', id: '11' }, signal],
    ])
  })

  it('resolves to null for an id it was not given, without asking', async () => {
    const fetchBody = vi.fn(() => Promise.resolve(null))
    const { signal } = new AbortController()
    const sample: InboxSummary = { ...summary('31', 'one@mail.example'), messageId: undefined }
    const load = liveBodyLoader([...messages, sample], fetchBody)

    await expect(load('99', { signal })).resolves.toBeNull()
    // A message id is not a row's identity.
    await expect(load('11', { signal })).resolves.toBeNull()
    // A row without a provider message id has nothing to read.
    await expect(load(sample.id, { signal })).resolves.toBeNull()
    expect(fetchBody).not.toHaveBeenCalled()
  })
})
