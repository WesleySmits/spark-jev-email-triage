import { describe, expect, it, vi } from 'vitest'
import type { InboxSummary } from './inbox'
import { bodyRequestSchema, liveBodyLoader } from './live-inbox'

const summary = (id: string, mailbox: string): InboxSummary => ({
  id,
  workflow: 'inbox',
  mailbox,
  sender: 'Sample Sender',
  time: '09:00',
  subject: `Subject ${id}`,
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
  const messages = [summary('11', 'one@mail.example'), summary('21', 'two@mail.example')]

  it("asks for one message in the mailbox its summary names, with the page's signal", async () => {
    const fetchBody = vi.fn(() => Promise.resolve({ id: '21', text: 'Hello' }))
    const { signal } = new AbortController()

    await expect(liveBodyLoader(messages, fetchBody)('21', { signal })).resolves.toEqual({
      id: '21',
      text: 'Hello',
    })
    expect(fetchBody).toHaveBeenCalledExactlyOnceWith(
      { mailbox: 'two@mail.example', id: '21' },
      signal,
    )
  })

  it('resolves to null for an id it was not given, without asking', async () => {
    const fetchBody = vi.fn(() => Promise.resolve(null))

    await expect(
      liveBodyLoader(messages, fetchBody)('99', { signal: new AbortController().signal }),
    ).resolves.toBeNull()
    expect(fetchBody).not.toHaveBeenCalled()
  })
})
