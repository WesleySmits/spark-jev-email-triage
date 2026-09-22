import { describe, expect, it } from 'vitest'
import type { MailboxAccess, MailReader } from '../domain/mail-reader'
import { sparkArguments, type SparkCommand } from '../spark/commands'
import { SparkError } from '../spark/errors'
import { accountsOutput, emailsTable, threadText } from '../spark/fixtures'
import type { SparkTransport } from '../spark/process'
import { createSparkMailReader } from '../spark/reader'
import {
  BodyUnavailableError,
  createLiveInbox,
  isLoopback,
  maxMailboxes,
  perMailbox,
} from './live-inbox.server'

// Synthetic mail only: every address uses a reserved `.example` domain.
type Listing = Awaited<ReturnType<MailReader['listRecentEmails']>>[number]
type Thread = Awaited<ReturnType<MailReader['readThread']>>

const access = (address: string, canRead = true): MailboxAccess => ({
  mailbox: { id: address, address },
  kind: 'account',
  canRead,
})

const listing = (
  mailboxId: string,
  messageId: string,
  date: string | null,
  change: Partial<Listing> = {},
): Listing => ({
  messageId,
  mailboxId,
  from: { address: 'sender@mail.example', name: 'Sample Sender' },
  subject: `Subject ${messageId}`,
  date,
  ...change,
})

const thread = (messages: readonly { id: string; bodyText: string | null }[]): Thread => ({
  id: messages[0]?.id ?? '1',
  mailboxId: 'one@mail.example',
  subject: 'Subject',
  messages: messages.map(({ id, bodyText }) => ({
    id,
    from: { address: 'sender@mail.example', name: null },
    to: [],
    cc: [],
    sentAt: null,
    bodyText,
    attachments: [],
  })),
})

type FakeMail = Readonly<{
  mailboxes?: MailboxAccess[] | Error
  listings?: Readonly<Record<string, Listing[] | Error>>
  threads?: Readonly<Record<string, Thread | Error>>
}>

/** A synthetic reader that records every call and fails if two overlap. */
function fakeReader({ mailboxes = [], listings = {}, threads = {} }: FakeMail) {
  const calls: string[] = []
  let inFlight = 0
  const answer = async <T>(call: string, value: T | Error | undefined, fallback: T) => {
    calls.push(call)
    inFlight += 1
    if (inFlight > 1) throw new Error('Calls overlapped')
    await new Promise((resolve) => setTimeout(resolve, 1))
    inFlight -= 1
    if (value instanceof Error) throw value
    return value ?? fallback
  }
  const reader: MailReader = {
    listMailboxes: () => answer('accounts', mailboxes, []),
    listRecentEmails: ({ mailboxId, limit }) =>
      answer(`emails ${mailboxId} ${String(limit)}`, listings[mailboxId], []),
    readThread: ({ messageId }) =>
      answer(
        `thread ${messageId}`,
        threads[messageId],
        thread([{ id: messageId, bodyText: null }]),
      ),
  }
  return { reader, calls }
}

// Tuesday 22 September 2026, 12:00 in Amsterdam.
const now = () => new Date('2026-09-22T10:00:00Z')
const inbox = (mail: FakeMail) => {
  const fake = fakeReader(mail)
  return {
    ...fake,
    live: createLiveInbox({ reader: fake.reader, timeZone: 'Europe/Amsterdam', now }),
  }
}

const one = 'one@mail.example'
const two = 'two@mail.example'

describe('createLiveInbox list', () => {
  it('lists each readable mailbox in turn, a bounded number of messages each', async () => {
    const { live, calls } = inbox({
      mailboxes: [access(one), access('closed@mail.example', false), access(two)],
    })
    const result = await live.list()

    expect(calls).toEqual([
      'accounts',
      `emails ${one} ${String(perMailbox)}`,
      `emails ${two} ${String(perMailbox)}`,
    ])
    expect(result).toMatchObject({ status: 'ready', readAt: '12:00', messages: [] })
  })

  it(`lists at most ${String(maxMailboxes)} mailboxes`, async () => {
    const addresses = Array.from({ length: 7 }, (_, index) => `box${String(index)}@mail.example`)
    const { live, calls } = inbox({ mailboxes: addresses.map((address) => access(address)) })
    const result = await live.list()

    expect(calls.filter((call) => call.startsWith('emails'))).toHaveLength(maxMailboxes)
    if (result.status !== 'ready') throw new Error('Expected a list')
    expect(result.mailboxes.map((mailbox) => mailbox.id)).toEqual(addresses.slice(0, maxMailboxes))
  })

  it('keeps mailbox identity apart from its marker, which is only a color', async () => {
    const addresses = Array.from({ length: 4 }, (_, index) => `box${String(index)}@mail.example`)
    const { live } = inbox({
      mailboxes: addresses.map((address) => access(address)),
      listings: { 'box3@mail.example': [listing('box3@mail.example', '9', null)] },
    })
    const result = await live.list()
    if (result.status !== 'ready') throw new Error('Expected a list')

    expect(result.mailboxes).toEqual([
      { id: 'box0@mail.example', account: 'studio', label: 'box0@mail.example' },
      { id: 'box1@mail.example', account: 'atelier', label: 'box1@mail.example' },
      { id: 'box2@mail.example', account: 'personal', label: 'box2@mail.example' },
      { id: 'box3@mail.example', account: 'studio', label: 'box3@mail.example' },
    ])
    expect(result.messages[0]).toMatchObject({
      mailbox: 'box3@mail.example',
      account: { marker: 'studio', label: 'box3@mail.example' },
    })
  })

  it('maps listings to strict summaries without a body, newest first, each message once', async () => {
    const { live } = inbox({
      mailboxes: [access(one), access(two)],
      listings: {
        [one]: [
          listing(one, '11', '2026-09-22T09:15:00+02:00'),
          listing(one, '12', null),
          listing(one, '13', '2026-09-18T08:00:00+02:00'),
        ],
        [two]: [
          listing(two, '21', '2026-09-22T11:30:00+02:00'),
          listing(two, '11', '2026-09-22T09:15:00+02:00'),
          listing(two, '22', '2025-12-01T08:00:00+01:00', { from: null, subject: null }),
          listing(two, '23', '2026-08-02T08:00:00+02:00'),
        ],
      },
    })
    const result = await live.list()
    if (result.status !== 'ready') throw new Error('Expected a list')

    expect(result.messages.map((message) => [message.id, message.mailbox, message.time])).toEqual([
      ['21', two, '11:30'],
      ['11', one, '09:15'],
      ['13', one, 'Fri'],
      ['23', two, '2 Aug'],
      ['22', two, '1 Dec 2025'],
      ['12', one, ''],
    ])
    expect(result.messages[0]).toEqual({
      id: '21',
      workflow: 'inbox',
      mailbox: two,
      sender: 'Sample Sender',
      address: 'sender@mail.example',
      time: '11:30',
      dateTime: '2026-09-22T11:30:00+02:00',
      subject: 'Subject 21',
      snippet: '',
      account: { marker: 'atelier', label: two },
      status: { label: 'Not triaged', tone: 'neutral' },
    })
    expect(result.messages.find((message) => message.id === '22')).toMatchObject({
      sender: 'Sender unavailable',
      subject: 'Subject unavailable',
    })
    for (const message of result.messages) {
      expect(message).not.toHaveProperty('body')
      expect(message).not.toHaveProperty('bodyText')
    }
  })

  it('is ready and empty when no mailbox is readable', async () => {
    const { live, calls } = inbox({ mailboxes: [access(one, false)] })

    await expect(live.list()).resolves.toEqual({
      status: 'ready',
      readAt: '12:00',
      mailboxes: [],
      messages: [],
    })
    expect(calls).toEqual(['accounts'])
  })

  it.each([
    ['missing', new SparkError('not_installed')],
    ['failed', new SparkError('timeout')],
    ['failed', new SparkError('exit_failure', null, 1)],
    ['malformed', new SparkError('malformed_output', 'emails: row 1 is invalid')],
    ['failed', new Error('Something unexpected')],
  ])('is unavailable (%s) without any message when Spark fails', async (reason, error) => {
    const { live } = inbox({
      mailboxes: [access(one), access(two)],
      listings: { [one]: [listing(one, '11', null)], [two]: error },
    })

    await expect(live.list()).resolves.toEqual({ status: 'unavailable', reason })
  })

  it('is unavailable when the mailboxes cannot be discovered', async () => {
    const { live, calls } = inbox({ mailboxes: new SparkError('not_installed') })

    await expect(live.list()).resolves.toEqual({ status: 'unavailable', reason: 'missing' })
    expect(calls).toEqual(['accounts'])
  })
})

describe('createLiveInbox body', () => {
  const mail: FakeMail = {
    mailboxes: [access(one)],
    listings: { [one]: [listing(one, '11', null), listing(one, '12', null)] },
    threads: {
      '11': thread([
        { id: '10', bodyText: 'An earlier message' },
        { id: '11', bodyText: 'The requested message' },
      ]),
      '12': thread([{ id: '12', bodyText: null }]),
    },
  }

  it("returns the requested message's plain text, naming it", async () => {
    const { live, calls } = inbox(mail)
    await live.list()

    await expect(live.body({ mailbox: one, id: '11' })).resolves.toEqual({
      id: '11',
      text: 'The requested message',
    })
    expect(calls.at(-1)).toBe('thread 11')
  })

  it('resolves to null for a message without a plain-text body', async () => {
    const { live } = inbox(mail)
    await live.list()

    await expect(live.body({ mailbox: one, id: '12' })).resolves.toBeNull()
  })

  it('lists again first when it has not listed the message, e.g. after a restart', async () => {
    const { live, calls } = inbox(mail)

    await expect(live.body({ mailbox: one, id: '11' })).resolves.toMatchObject({ id: '11' })
    expect(calls).toEqual(['accounts', `emails ${one} ${String(perMailbox)}`, 'thread 11'])
  })

  it('never reads a message it did not list', async () => {
    const { live, calls } = inbox(mail)
    await live.list()

    await expect(live.body({ mailbox: one, id: '99' })).rejects.toThrow(BodyUnavailableError)
    await expect(live.body({ mailbox: two, id: '11' })).rejects.toThrow(BodyUnavailableError)
    expect(calls.filter((call) => call.startsWith('thread'))).toEqual([])
  })

  it('fails with a fixed message, never what the provider said', async () => {
    const { live } = inbox({
      ...mail,
      threads: { '11': new SparkError('malformed_output', 'thread: message 1 is invalid') },
    })
    await live.list()

    await expect(live.body({ mailbox: one, id: '11' })).rejects.toThrow(
      new BodyUnavailableError().message,
    )
  })
})

describe('isLoopback', () => {
  it('allows only requests from this computer', () => {
    for (const ip of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) expect(isLoopback(ip)).toBe(true)
    for (const ip of [undefined, '', '192.168.1.20', '10.0.0.1', '::ffff:10.0.0.1']) {
      expect(isLoopback(ip)).toBe(false)
    }
  })
})

describe('createLiveInbox over the Spark reader', () => {
  it('only runs the read-only accounts, emails and thread commands', async () => {
    const commands: SparkCommand[] = []
    const transport: SparkTransport = (command) => {
      commands.push(command)
      if (command.name === 'accounts') return Promise.resolve(accountsOutput)
      if (command.name === 'thread') {
        return Promise.resolve(
          threadText('Sample', [
            { id: '4001', from: 'sam@mail.example', date: '2026-09-22 09:00', body: 'Hello' },
          ]),
        )
      }
      return Promise.resolve(
        emailsTable([
          ['4001', command.mailboxId, 'sam@mail.example', '2026-09-22 09:00', 'Hi', ''],
        ]),
      )
    }
    const reader = createSparkMailReader({
      transport,
      timeZone: 'Europe/Amsterdam',
      log: () => undefined,
    })
    const live = createLiveInbox({ reader, timeZone: 'Europe/Amsterdam', now })

    const result = await live.list()
    const body = await live.body({ mailbox: 'Ops@Example.com', id: '4001' })

    expect(result.status).toBe('ready')
    expect(body).toEqual({ id: '4001', text: 'Hello' })
    expect(commands.map((command) => sparkArguments(command)[0])).toEqual([
      'accounts',
      'emails',
      'emails',
      'emails',
      'emails',
      'thread',
    ])
    for (const command of commands) {
      if (command.name === 'emails') expect(command.limit).toBe(perMailbox)
    }
  })
})
