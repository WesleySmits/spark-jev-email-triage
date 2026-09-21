import { describe, expect, it } from 'vitest'
import type { z } from 'zod'
import { threadSchema } from '../domain/email'
import { syntheticThreads } from '../domain/fixtures'
import { buildTriageState, stateLimits } from './state'

type Thread = z.infer<typeof threadSchema>
type Message = Thread['messages'][number]

const mailbox = 'inbox@example.com'
const parse = (thread: z.input<typeof threadSchema>) => threadSchema.parse(thread)

const withBody = (bodyText: string, extra: Partial<Message> = {}): Thread => {
  const thread = parse(syntheticThreads.customerQuestion)
  const [message] = thread.messages
  if (message === undefined) throw new Error('fixture has no message')
  return { ...thread, messages: [{ ...message, bodyText, ...extra }] }
}

const firstText = (thread: Thread) =>
  buildTriageState(thread, mailbox).email_thread.messages[0]?.text

describe('buildTriageState', () => {
  it('keeps only the fields the questions need', () => {
    expect(buildTriageState(parse(syntheticThreads.invoice), mailbox)).toEqual({
      email_thread: {
        subject: 'Invoice INV-0001 for January',
        omitted_earlier_messages: 0,
        messages: [
          {
            mailbox_owner_role: 'to',
            sender: { address: 'billing@vendor.example', name: 'Vendor Billing' },
            text: 'Your invoice for January is attached. Payment is due within 30 days.',
            text_truncated: false,
            attachments: [{ filename: 'INV-0001.pdf', media_type: 'application/pdf' }],
            omitted_attachments: 0,
          },
        ],
      },
    })
  })

  it("marks the mailbox owner's role on each message", () => {
    const state = buildTriageState(parse(syntheticThreads.multiMessage), ' Inbox@Example.com ')

    expect(state.email_thread.messages.map((message) => message.mailbox_owner_role)).toEqual([
      'to',
      'sender',
      'to',
    ])
    expect(
      buildTriageState(parse(syntheticThreads.multiMessage), 'other@example.com'),
    ).toMatchObject({ email_thread: { messages: [{ mailbox_owner_role: 'not_listed' }, {}, {}] } })
  })

  it('recognizes an owner who is only copied', () => {
    const thread = parse(syntheticThreads.multiMessage)

    expect(buildTriageState(thread, 'partner@example.org').email_thread.messages[2]).toMatchObject({
      mailbox_owner_role: 'cc',
    })
  })

  it('keeps the latest messages and counts the omitted history', () => {
    const thread = parse(syntheticThreads.multiMessage)
    const [first] = thread.messages
    if (first === undefined) throw new Error('fixture has no message')
    const long = {
      ...thread,
      messages: Array.from({ length: 7 }, (_, index) => ({
        ...first,
        id: `msg-${String(index)}`,
        bodyText: `Message ${String(index)}`,
      })),
    }
    const state = buildTriageState(long, mailbox)

    expect(state.email_thread.omitted_earlier_messages).toBe(2)
    expect(state.email_thread.messages.map((message) => message.text)).toEqual([
      'Message 2',
      'Message 3',
      'Message 4',
      'Message 5',
      'Message 6',
    ])
  })

  it('truncates the body, subject, and sender name', () => {
    const thread = withBody('word '.repeat(1000), {
      from: { address: 'customer@example.org', name: 'N'.repeat(500) },
    })
    const state = buildTriageState({ ...thread, subject: 'S'.repeat(500) }, mailbox)
    const [message] = state.email_thread.messages

    expect(state.email_thread.subject).toHaveLength(stateLimits.subjectChars + 1)
    expect(message?.sender.name).toHaveLength(stateLimits.nameChars + 1)
    expect(message?.text).toHaveLength(stateLimits.bodyChars + 1)
    expect(message?.text?.endsWith('…')).toBe(true)
    expect(message?.text_truncated).toBe(true)
  })

  it('does not split a character when truncating', () => {
    const text = firstText(withBody('😀'.repeat(stateLimits.bodyChars)))

    expect(text).toMatch(/^(😀)+…$/u)
    expect(Array.from(text ?? '')).toHaveLength(stateLimits.bodyChars / 2 + 1)
  })

  it('drops quoted reply history', () => {
    const body = [
      'A replacement, please.',
      '',
      'On Sat, 10 Jan 2026 at 11:30, Example Support <inbox@example.com> wrote:',
      '> Would you like a replacement or a refund?',
    ].join('\n')

    expect(firstText(withBody(body))).toBe('A replacement, please.')
    expect(firstText(withBody('Thanks!\n> earlier text\n>> older text'))).toBe('Thanks!')
  })

  it('removes link queries, fragments, and opaque tokens', () => {
    const body =
      'Reset at https://accounts.example/reset/9f8e7d6c5b4a39281706f5e4?utm_source=mail#top ' +
      'or use key key_synthetic_0a1b2c3d4e5f6a7b8c9d.'

    expect(firstText(withBody(body))).toBe(
      'Reset at https://accounts.example/reset/[redacted] or use key [redacted].',
    )
  })

  it('keeps punctuation that follows a link', () => {
    expect(
      firstText(withBody('Go to https://promo.example/claim?uid=1. Or https://a.example/x, now')),
    ).toBe('Go to https://promo.example/claim. Or https://a.example/x, now')
  })

  it('scrubs links and tokens from the subject, sender name, and attachment name', () => {
    const thread = withBody('Hi', {
      from: { address: 'customer@example.org', name: 'Support 9f8e7d6c5b4a39281706f5e4' },
      attachments: [
        {
          filename: 'https://files.example/get?sig=abc.pdf',
          mediaType: 'application/pdf',
          sizeBytes: 1,
        },
      ],
    })
    const state = buildTriageState(
      { ...thread, subject: 'Reset via https://accounts.example/reset?token=abc123' },
      mailbox,
    )
    const [message] = state.email_thread.messages

    expect(state.email_thread.subject).toBe('Reset via https://accounts.example/reset')
    expect(message?.sender.name).toBe('Support [redacted]')
    expect(message?.attachments[0]?.filename).toBe('https://files.example/get')
  })

  it('replaces a link it cannot parse', () => {
    expect(firstText(withBody('See https://bad%host/path now'))).toBe('See [link] now')
  })

  it('represents missing or empty text as null', () => {
    expect(firstText(parse(syntheticThreads.newsletter))).toBeNull()
    expect(firstText(withBody('> only quoted text'))).toBeNull()
    expect(
      buildTriageState(parse(syntheticThreads.ambiguous), mailbox).email_thread.subject,
    ).toBeNull()
  })

  it('never includes attachment contents, sizes, recipients, or timestamps', () => {
    const attachment = { filename: 'secret.pdf', mediaType: 'application/pdf', sizeBytes: 9 }
    // Wider than the domain type, as if a provider leaked extra fields.
    const leaky = { ...attachment, content: 'JVBERi0xLjQgc3ludGhldGljIGF0dGFjaG1lbnQ=' }
    const thread = withBody('See attached.', {
      attachments: [leaky],
      cc: [{ address: 'partner@example.org', name: 'Partner' }],
    })
    const serialized = JSON.stringify(buildTriageState(thread, mailbox))

    expect(serialized).toContain('secret.pdf')
    for (const absent of [leaky.content, 'sizeBytes', 'partner@example.org', '2026-01-05']) {
      expect(serialized).not.toContain(absent)
    }
  })

  it('shows a bounded number of attachments and counts the rest', () => {
    const attachments = Array.from({ length: 12 }, (_, index) => ({
      filename: `part-${String(index)}.txt`,
      mediaType: 'text/plain',
      sizeBytes: 1,
    }))
    const [message] = buildTriageState(withBody('Files', { attachments }), mailbox).email_thread
      .messages

    expect(message?.attachments).toHaveLength(stateLimits.attachments)
    expect(message?.omitted_attachments).toBe(2)
  })

  it('rejects an invalid mailbox address', () => {
    expect(() => buildTriageState(parse(syntheticThreads.invoice), 'not an address')).toThrow()
  })
})
