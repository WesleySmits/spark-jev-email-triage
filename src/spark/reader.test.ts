import { describe, expect, it, vi } from 'vitest'
import type { SparkCommand } from './commands'
import { SparkError } from './errors'
import { accountsOutput, emailsOutput, emptyEmailsOutput, threadOutput } from './fixtures'
import type { SparkTransport } from './process'
import { createSparkMailReader, type SparkLogEntry } from './reader'

function setup(respond: (command: SparkCommand) => string | Promise<string>) {
  const transport = vi.fn<SparkTransport>((command) => Promise.resolve(respond(command)))
  const entries: SparkLogEntry[] = []
  const reader = createSparkMailReader({
    transport,
    timeZone: 'Europe/Amsterdam',
    log: (entry) => entries.push(entry),
  })
  return { reader, transport, entries }
}

const outputs = (overrides: Partial<Record<SparkCommand['name'], string>> = {}) => {
  const all = { accounts: accountsOutput, emails: emailsOutput, thread: threadOutput, ...overrides }
  return (command: SparkCommand) => all[command.name]
}

const threadRequest = { mailboxId: 'support@example.com', messageId: '1002' }

describe('listMailboxes', () => {
  it('lists accounts and shared inboxes once each', async () => {
    const { reader } = setup(outputs())

    expect(await reader.listMailboxes()).toEqual([
      {
        mailbox: { id: 'Ops@Example.com', address: 'ops@example.com' },
        kind: 'account',
        canRead: true,
      },
      {
        mailbox: { id: 'support@example.com', address: 'support@example.com' },
        kind: 'shared_inbox',
        canRead: true,
      },
      {
        mailbox: { id: 'person@example.org', address: 'person@example.org' },
        kind: 'account',
        canRead: true,
      },
      {
        mailbox: { id: 'archive@example.net', address: 'archive@example.net' },
        kind: 'account',
        canRead: false,
      },
      {
        mailbox: { id: 'other@example.net', address: 'other@example.net' },
        kind: 'account',
        canRead: true,
      },
    ])
  })

  it('returns no mailboxes for empty output', async () => {
    const { reader } = setup(outputs({ accounts: '\n' }))

    expect(await reader.listMailboxes()).toEqual([])
  })

  it.each([
    ['output without accounts', 'Spark is starting, try again later.\n'],
    ['an account without an address', 'Email Account: Operations (Access: triage)\n'],
    ['an account without an access level', 'Email Account: ops@example.com "Operations"\n'],
  ])('rejects %s', async (_, output) => {
    const { reader } = setup(outputs({ accounts: output }))

    await expect(reader.listMailboxes()).rejects.toMatchObject({ code: 'malformed_output' })
  })
})

describe('listRecentEmails', () => {
  const request = { mailboxId: 'support@example.com', limit: 3 }

  it('lists messages and marks shortened or missing values unavailable', async () => {
    const { reader } = setup(outputs())

    expect(await reader.listRecentEmails(request)).toEqual([
      {
        messageId: '1003',
        mailboxId: 'support@example.com',
        from: { address: 'sam@example.org', name: 'Sam Customer' },
        subject: 'Damaged item in order EX-1002 🇳🇱',
        date: '2026-01-10T12:05:00+01:00',
      },
      {
        messageId: '1002',
        mailboxId: 'support@example.com',
        from: { address: 'alerts@monitoring.example', name: null },
        subject: null,
        date: '2026-07-01T09:30:00+02:00',
      },
      {
        messageId: '1001',
        mailboxId: 'support@example.com',
        from: null,
        subject: null,
        date: null,
      },
    ])
  })

  it('returns no messages when the mailbox has none', async () => {
    const { reader } = setup(outputs({ emails: emptyEmailsOutput }))

    expect(await reader.listRecentEmails(request)).toEqual([])
  })

  it('rejects more rows than requested', async () => {
    const { reader } = setup(outputs())

    await expect(reader.listRecentEmails({ ...request, limit: 2 })).rejects.toMatchObject({
      code: 'malformed_output',
    })
  })

  it.each([
    ['output without a table', 'Emails in support@example.com:Inbox\n'],
    ['a table without rows', emailsOutput.replace(/^ {2}1\d{3} .*$/gm, '').replace(/\n+/g, '\n')],
    ['a misaligned row', emailsOutput.replace('  1003   ', '  1003 ')],
    ['an unrecognized date', emailsOutput.replace('2026-01-10 12:05', '10 Jan 12:05    ')],
  ])('rejects %s', async (_, output) => {
    const { reader } = setup(outputs({ emails: output }))

    await expect(reader.listRecentEmails(request)).rejects.toMatchObject({
      code: 'malformed_output',
    })
  })
})

describe('readThread', () => {
  it('parses messages, participants, bodies, and attachments', async () => {
    const { reader } = setup(outputs())

    expect(await reader.readThread(threadRequest)).toEqual({
      id: '1001',
      mailboxId: 'support@example.com',
      subject: 'Damaged item in order EX-1002',
      messages: [
        {
          id: '1001',
          from: { address: 'customer@example.org', name: 'Customer, Sample' },
          to: [{ address: 'support@example.com', name: 'Example Support' }],
          cc: [],
          sentAt: '2026-01-10T10:00:00+01:00',
          bodyText: 'The item in order EX-1002 arrived damaged. A photo is attached.',
          attachments: [
            { filename: 'photo.jpg', mediaType: 'image/jpeg', sizeBytes: null },
            { filename: 'receipt.txt', mediaType: 'text/plain', sizeBytes: 812 },
          ],
        },
        {
          id: '1002',
          from: { address: 'support@example.com', name: null },
          to: [{ address: 'customer@example.org', name: 'Customer, Sample' }],
          cc: [
            { address: 'partner@example.org', name: null },
            { address: 'lead@example.com', name: 'Team Lead' },
          ],
          sentAt: '2026-01-10T11:30:00+01:00',
          bodyText:
            'Sorry about that. Would you like a replacement or a refund?\n\nAttachments:\nPlease reply with your choice.',
          attachments: [],
        },
      ],
    })
  })

  it('treats a missing Date header as unavailable', async () => {
    const { reader } = setup(
      outputs({ thread: threadOutput.replace('  Date: 2026-01-10 11:30\n', '') }),
    )

    const thread = await reader.readThread(threadRequest)
    expect(thread.messages[1]?.sentAt).toBeNull()
  })

  it.each([
    ['a message count mismatch', threadOutput.replace('Messages: 3', 'Messages: 4')],
    ['a missing thread summary', threadOutput.replace(/^Thread: .*\n/, '')],
    ['a missing sender', threadOutput.replace('  From: support@example.com\n', '')],
    ['an invalid recipient', threadOutput.replace('partner@example.org,', 'partner,')],
    ['an unreadable header', threadOutput.replace('  Type: Email\n  Flags', '  Type: Email\n  !!')],
    [
      'an unreadable attachment row',
      threadOutput.replace('812 B   text/plain', '812 B text/plain'),
    ],
    [
      'duplicate message ids',
      threadOutput.replace('ID: 1003', 'ID: 1001').replace('Comment', 'Email'),
    ],
    ['no email messages', threadOutput.replaceAll('Type: Email', 'Type: Comment')],
  ])('rejects %s', async (_, output) => {
    const { reader } = setup(outputs({ thread: output }))

    await expect(reader.readThread(threadRequest)).rejects.toMatchObject({
      code: 'malformed_output',
    })
  })

  it('rejects a thread that does not contain the requested message', async () => {
    const { reader } = setup(outputs())

    await expect(reader.readThread({ ...threadRequest, messageId: '9999' })).rejects.toMatchObject({
      code: 'malformed_output',
    })
  })

  it.each([
    ['message id', { ...threadRequest, messageId: '--download-attachments' }],
    ['mailbox id', { ...threadRequest, mailboxId: 'Support Team' }],
  ])('rejects an invalid %s without calling Spark', async (_, request) => {
    const { reader, transport } = setup(outputs())

    await expect(reader.readThread(request)).rejects.toMatchObject({ code: 'invalid_input' })
    expect(transport).not.toHaveBeenCalled()
  })
})

describe('call handling', () => {
  it('runs calls one at a time', async () => {
    const pending: (() => void)[] = []
    const { reader, transport } = setup(
      (command) =>
        new Promise((resolve) => {
          pending.push(() => {
            resolve(outputs()(command))
          })
        }),
    )

    const mailboxes = reader.listMailboxes()
    const thread = reader.readThread(threadRequest)
    await vi.waitFor(() => {
      expect(transport).toHaveBeenCalledTimes(1)
    })
    await Promise.resolve()
    expect(transport).toHaveBeenCalledTimes(1)

    pending.shift()?.()
    await mailboxes
    await vi.waitFor(() => {
      expect(transport).toHaveBeenCalledTimes(2)
    })
    pending.shift()?.()
    await expect(thread).resolves.toMatchObject({ id: '1001' })
  })

  it('keeps running after a failed call', async () => {
    const { reader } = setup((command) => {
      if (command.name === 'accounts') throw new SparkError('timeout')
      return outputs()(command)
    })

    await expect(reader.listMailboxes()).rejects.toMatchObject({ code: 'timeout' })
    await expect(reader.readThread(threadRequest)).resolves.toMatchObject({ id: '1001' })
  })

  it('does not call Spark for a call cancelled while queued', async () => {
    const { reader, transport } = setup(outputs())
    const controller = new AbortController()

    const first = reader.listMailboxes()
    const second = reader.readThread(threadRequest, { signal: controller.signal })
    controller.abort()

    await first
    await expect(second).rejects.toMatchObject({ code: 'aborted' })
    expect(transport).toHaveBeenCalledTimes(1)
  })

  it('passes the cancellation signal to the transport', async () => {
    const { reader, transport } = setup(outputs())
    const { signal } = new AbortController()

    await reader.listMailboxes({ signal })
    expect(transport).toHaveBeenCalledWith({ name: 'accounts' }, signal)
  })

  it('logs each call without mailbox content', async () => {
    const { reader, entries } = setup(outputs({ emails: 'garbage from spark\n' }))

    await reader.listMailboxes()
    await reader.readThread(threadRequest)
    await reader.listRecentEmails({ mailboxId: 'support@example.com', limit: 3 }).catch(() => null)
    await reader.readThread({ ...threadRequest, messageId: 'x' }).catch(() => null)

    expect(
      entries.map(({ durationMs, ...entry }) => ({ ...entry, durationMs: typeof durationMs })),
    ).toEqual([
      {
        event: 'spark_call',
        command: 'accounts',
        outcome: 'ok',
        itemCount: 5,
        durationMs: 'number',
      },
      { event: 'spark_call', command: 'thread', outcome: 'ok', itemCount: 2, durationMs: 'number' },
      {
        event: 'spark_call',
        command: 'emails',
        outcome: 'malformed_output',
        itemCount: null,
        durationMs: 'number',
      },
      {
        event: 'spark_call',
        command: 'thread',
        outcome: 'invalid_input',
        itemCount: null,
        durationMs: 'number',
      },
    ])
    const logged = JSON.stringify(entries)
    for (const secret of ['@', 'example', 'Damaged', 'garbage', '1001', '1002']) {
      expect(logged).not.toContain(secret)
    }
  })
})
