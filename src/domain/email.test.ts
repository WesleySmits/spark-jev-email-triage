import { describe, expect, it } from 'vitest'
import type { z } from 'zod'
import { emailSummarySchema, mailboxSchema, threadSchema } from './email'

type ThreadInput = z.input<typeof threadSchema>
type MessageInput = ThreadInput['messages'][number]

const message = (overrides: Partial<MessageInput> = {}): MessageInput => ({
  id: 'msg-1',
  from: { address: 'sender@example.com', name: 'Sender' },
  to: [{ address: 'inbox@example.com', name: null }],
  cc: [],
  sentAt: '2026-01-05T09:00:00Z',
  bodyText: 'Hello',
  attachments: [],
  ...overrides,
})

const thread = (overrides: Partial<ThreadInput> = {}): ThreadInput => ({
  id: 'thread-1',
  mailboxId: 'mailbox-1',
  subject: 'Subject',
  messages: [message()],
  ...overrides,
})

const summary = {
  threadId: 'thread-1',
  mailboxId: 'mailbox-1',
  subject: 'Subject',
  from: { address: 'sender@example.com', name: null },
  snippet: 'Hello',
  receivedAt: '2026-01-05T09:00:00+01:00',
  messageCount: 1,
}

const issuePaths = (result: { error?: z.ZodError | undefined }) =>
  result.error?.issues.map((issue) => issue.path.join('.')) ?? []

describe('mailboxSchema', () => {
  it('normalizes the mailbox address', () => {
    expect(mailboxSchema.parse({ id: 'mailbox-1', address: '  Inbox@Example.COM ' })).toEqual({
      id: 'mailbox-1',
      address: 'inbox@example.com',
    })
  })

  it.each([
    ['a blank id', { id: '  ', address: 'inbox@example.com' }, 'id'],
    ['an invalid address', { id: 'mailbox-1', address: 'not-an-address' }, 'address'],
  ])('rejects %s', (_, input, path) => {
    expect(issuePaths(mailboxSchema.safeParse(input))).toEqual([path])
  })
})

describe('emailSummarySchema', () => {
  it('accepts a summary and keeps the timestamp offset', () => {
    expect(emailSummarySchema.parse(summary)).toEqual(summary)
  })

  it.each([
    ['a zero message count', { messageCount: 0 }, 'messageCount'],
    ['a fractional message count', { messageCount: 1.5 }, 'messageCount'],
    ['a timestamp without offset', { receivedAt: '2026-01-05 09:00' }, 'receivedAt'],
    ['an unknown receipt time', { receivedAt: null }, 'receivedAt'],
  ])('rejects %s', (_, overrides, path) => {
    expect(issuePaths(emailSummarySchema.safeParse({ ...summary, ...overrides }))).toEqual([path])
  })

  it('rejects fields outside the contract', () => {
    const result = emailSummarySchema.safeParse({ ...summary, labels: ['inbox'] })

    expect(result.error?.issues[0]?.code).toBe('unrecognized_keys')
  })
})

describe('threadSchema', () => {
  it('normalizes participants and turns blank text into null', () => {
    const parsed = threadSchema.parse(
      thread({
        subject: '   ',
        messages: [
          message({
            from: { address: ' Sender@Example.com', name: '' },
            bodyText: '',
          }),
        ],
      }),
    )

    expect(parsed.subject).toBeNull()
    expect(parsed.messages[0]).toMatchObject({
      from: { address: 'sender@example.com', name: null },
      bodyText: null,
    })
  })

  it('accepts explicitly unknown values', () => {
    const parsed = threadSchema.parse(
      thread({
        subject: null,
        messages: [
          message({
            sentAt: null,
            bodyText: null,
            attachments: [{ filename: null, mediaType: null, sizeBytes: null }],
          }),
        ],
      }),
    )

    expect(parsed.messages[0]?.attachments[0]).toEqual({
      filename: null,
      mediaType: null,
      sizeBytes: null,
    })
  })

  it('requires unknown values to be explicit rather than omitted', () => {
    const withoutSentAt: Partial<MessageInput> = message()
    delete withoutSentAt.sentAt

    expect(issuePaths(threadSchema.safeParse({ ...thread(), messages: [withoutSentAt] }))).toEqual([
      'messages.0.sentAt',
    ])
  })

  it('rejects a thread without messages', () => {
    expect(issuePaths(threadSchema.safeParse(thread({ messages: [] })))).toEqual(['messages'])
  })

  it('rejects duplicate message ids', () => {
    const result = threadSchema.safeParse(thread({ messages: [message(), message()] }))

    expect(result.error?.issues).toMatchObject([
      { path: ['messages'], message: 'Message ids must be unique within a thread' },
    ])
  })

  it('rejects attachment contents', () => {
    const attachment = { filename: 'a.pdf', mediaType: 'application/pdf', sizeBytes: 3 }
    const result = threadSchema.safeParse({
      ...thread(),
      messages: [{ ...message(), attachments: [{ ...attachment, content: 'JVBE' }] }],
    })

    expect(result.error?.issues).toMatchObject([
      { code: 'unrecognized_keys', keys: ['content'], path: ['messages', 0, 'attachments', 0] },
    ])
  })

  it.each([
    ['a negative attachment size', { sizeBytes: -1 }],
    ['a fractional attachment size', { sizeBytes: 1.5 }],
  ])('rejects %s', (_, overrides) => {
    const attachment = { filename: 'a.pdf', mediaType: 'application/pdf', sizeBytes: 3 }
    const result = threadSchema.safeParse(
      thread({ messages: [message({ attachments: [{ ...attachment, ...overrides }] })] }),
    )

    expect(issuePaths(result)).toEqual(['messages.0.attachments.0.sizeBytes'])
  })
})
