import { describe, expect, it } from 'vitest'
import type { MailboxAccess, MailReader } from '../domain/mail-reader'
import { mailboxCopyId } from '../domain/mailbox-copy'
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
  sender: { text: 'Sample Sender', cut: false },
  subject: { text: `Subject ${messageId}`, cut: false },
  date,
  ...change,
})

const thread = (
  messages: readonly { id: string; bodyText: string | null }[],
  mailboxId = 'one@mail.example',
): Thread => ({
  id: messages[0]?.id ?? '1',
  mailboxId,
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
  /** By message id, or by `mailbox id` for one mailbox's copy. */
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
    readThread: ({ mailboxId, messageId }) =>
      answer(
        `thread ${mailboxId} ${messageId}`,
        threads[`${mailboxId} ${messageId}`] ?? threads[messageId],
        thread([{ id: messageId, bodyText: null }], mailboxId),
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
const copy = (mailboxId: string, messageId: string) => mailboxCopyId({ mailboxId, messageId })

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
    expect(result).toMatchObject({ status: 'ready', messages: [] })
    expect(result).toHaveProperty('scope.readAt', '12:00')
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

  it('maps listings to strict summaries without a body, newest first, each mailbox copy once', async () => {
    const { live } = inbox({
      mailboxes: [access(one), access(two)],
      listings: {
        [one]: [
          listing(one, '11', '2026-09-22T09:15:00+02:00'),
          listing(one, '12', null),
          listing(one, '13', '2026-09-18T08:00:00+02:00'),
          listing(one, '13', '2026-09-18T08:00:00+02:00'),
        ],
        [two]: [
          listing(two, '21', '2026-09-22T11:30:00+02:00'),
          listing(two, '11', '2026-09-22T09:15:00+02:00'),
          listing(two, '22', '2025-12-01T08:00:00+01:00', {
            from: null,
            sender: null,
            subject: null,
          }),
          listing(two, '23', '2026-08-02T08:00:00+02:00'),
        ],
      },
    })
    const result = await live.list()
    if (result.status !== 'ready') throw new Error('Expected a list')

    expect(
      result.messages.map((message) => [message.messageId, message.mailbox, message.time]),
    ).toEqual([
      ['21', two, '11:30'],
      ['11', one, '09:15'],
      ['11', two, '09:15'],
      ['13', one, 'Fri'],
      ['23', two, '2 Aug'],
      ['22', two, '1 Dec 2025'],
      ['12', one, ''],
    ])
    expect(result.messages[0]).toEqual({
      id: copy(two, '21'),
      messageId: '21',
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
    expect(result.messages.find((message) => message.messageId === '22')).toMatchObject({
      sender: 'Sender unavailable',
      subject: 'Subject unavailable',
    })
    for (const message of result.messages) {
      expect(message).not.toHaveProperty('body')
      expect(message).not.toHaveProperty('bodyText')
    }
  })

  it('shows the visible start of a value the list cut, ending in …', async () => {
    const { live } = inbox({
      mailboxes: [access(one)],
      listings: {
        [one]: [
          listing(one, '11', null, {
            from: null,
            sender: { text: 'Newsletter Te', cut: true },
            subject: { text: 'A long subj', cut: true },
          }),
          listing(one, '12', null, { from: null, sender: { text: 'Named Sender', cut: false } }),
        ],
      },
    })
    const result = await live.list()
    if (result.status !== 'ready') throw new Error('Expected a list')

    expect(result.messages[0]).toMatchObject({ sender: 'Newsletter Te…', subject: 'A long subj…' })
    expect(result.messages[0]).not.toHaveProperty('address')
    expect(result.messages[1]).toMatchObject({ sender: 'Named Sender', subject: 'Subject 12' })
    expect(result.messages[1]).not.toHaveProperty('address')
  })

  it('is ready and empty when no mailbox is readable', async () => {
    const { live, calls } = inbox({ mailboxes: [access(one, false)] })

    await expect(live.list()).resolves.toEqual({
      status: 'ready',
      scope: {
        mailboxes: [],
        readable: 0,
        mailboxLimit: maxMailboxes,
        messageLimit: perMailbox,
        loaded: 0,
        bounded: false,
        readAt: '12:00',
        refreshedAt: '2026-09-22T10:00:00.000Z',
      },
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
      id: copy(one, '11'),
      text: 'The requested message',
    })
    expect(calls.at(-1)).toBe(`thread ${one} 11`)
  })

  it('resolves to null for a message without a plain-text body', async () => {
    const { live } = inbox(mail)
    await live.list()

    await expect(live.body({ mailbox: one, id: '12' })).resolves.toBeNull()
  })

  it('lists again first when it has not listed the message, e.g. after a restart', async () => {
    const { live, calls } = inbox(mail)

    await expect(live.body({ mailbox: one, id: '11' })).resolves.toMatchObject({
      id: copy(one, '11'),
    })
    expect(calls).toEqual(['accounts', `emails ${one} ${String(perMailbox)}`, `thread ${one} 11`])
  })

  it('never reads a message it did not list', async () => {
    const { live, calls } = inbox(mail)
    await live.list()

    await expect(live.body({ mailbox: one, id: '99' })).rejects.toThrow(BodyUnavailableError)
    await expect(live.body({ mailbox: two, id: '11' })).rejects.toThrow(BodyUnavailableError)
    expect(calls.filter((call) => call.startsWith('thread'))).toEqual([])
  })

  it('offers no older body once a later list fails', async () => {
    const listings: Record<string, Listing[] | Error> = { [one]: [listing(one, '11', null)] }
    const { live, calls } = inbox({ ...mail, listings })
    await expect(live.list()).resolves.toMatchObject({ status: 'ready' })

    listings[one] = new SparkError('timeout')
    await expect(live.list()).resolves.toEqual({ status: 'unavailable', reason: 'failed' })

    await expect(live.body({ mailbox: one, id: '11' })).rejects.toThrow(BodyUnavailableError)
    expect(calls.filter((call) => call.startsWith('thread'))).toEqual([])
  })

  it('lets only the latest list decide what is offered', async () => {
    const answers: ((value: MailboxAccess[] | Error) => void)[] = []
    const threads: string[] = []
    const reader: MailReader = {
      listMailboxes: () =>
        new Promise((resolve, reject) => {
          answers.push((value) => {
            if (value instanceof Error) reject(value)
            else resolve(value)
          })
        }),
      listRecentEmails: ({ mailboxId }) => Promise.resolve([listing(mailboxId, '11', null)]),
      readThread: ({ messageId }) => {
        threads.push(messageId)
        return Promise.resolve(thread([{ id: messageId, bodyText: 'Text' }]))
      },
    }
    const live = createLiveInbox({ reader, timeZone: 'Europe/Amsterdam', now })
    const older = live.list()
    const newer = live.list()
    answers[1]?.(new SparkError('timeout'))
    await expect(newer).resolves.toMatchObject({ status: 'unavailable' })
    answers[0]?.([access(one)])
    await expect(older).resolves.toMatchObject({ status: 'ready' })

    const body = live.body({ mailbox: one, id: '11' })
    answers[2]?.(new SparkError('timeout'))
    await expect(body).rejects.toThrow(BodyUnavailableError)
    expect(threads).toEqual([])
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

describe('createLiveInbox alias copies', () => {
  // One delivery to two aliases: Spark lists the same message id in both.
  const mail: FakeMail = {
    mailboxes: [access(one), access(two)],
    listings: {
      [one]: [listing(one, '11', '2026-09-22T09:15:00+02:00')],
      [two]: [listing(two, '11', '2026-09-22T09:15:00+02:00')],
    },
    threads: {
      [`${one} 11`]: thread([{ id: '11', bodyText: 'The copy in one' }], one),
      [`${two} 11`]: thread([{ id: '11', bodyText: 'The copy in two' }], two),
    },
  }

  it('lists a row per mailbox copy, each with its own identity and the message id', async () => {
    const result = await inbox(mail).live.list()
    if (result.status !== 'ready') throw new Error('Expected a list')

    expect(
      result.messages.map(({ id, messageId, mailbox }) => ({ id, messageId, mailbox })),
    ).toEqual([
      { id: copy(one, '11'), messageId: '11', mailbox: one },
      { id: copy(two, '11'), messageId: '11', mailbox: two },
    ])
    expect(new Set(result.messages.map((message) => message.id)).size).toBe(2)
  })

  it('counts both copies in scope: one delivery to two aliases is two loaded rows', async () => {
    const result = await inbox(mail).live.list()
    if (result.status !== 'ready') throw new Error('Expected a list')

    expect(result.scope.loaded).toBe(2)
    expect(result.scope.mailboxes).toEqual([
      { id: one, label: one, loaded: 1, bounded: false },
      { id: two, label: two, loaded: 1, bounded: false },
    ])
    // The copies are never merged on message id, subject or contents.
    expect(result.scope.loaded).toBe(result.messages.length)
  })

  it('reads each copy through its own mailbox, naming the copy', async () => {
    const { live, calls } = inbox(mail)
    await live.list()

    await expect(live.body({ mailbox: two, id: '11' })).resolves.toEqual({
      id: copy(two, '11'),
      text: 'The copy in two',
    })
    await expect(live.body({ mailbox: one, id: '11' })).resolves.toEqual({
      id: copy(one, '11'),
      text: 'The copy in one',
    })
    expect(calls.filter((call) => call.startsWith('thread'))).toEqual([
      `thread ${two} 11`,
      `thread ${one} 11`,
    ])
  })

  it('offers only the copies the latest list still has', async () => {
    const listings: Record<string, Listing[] | Error> = { ...mail.listings }
    const { live, calls } = inbox({ ...mail, listings })
    await live.list()

    listings[two] = []
    await live.list()

    await expect(live.body({ mailbox: one, id: '11' })).resolves.toMatchObject({
      id: copy(one, '11'),
    })
    await expect(live.body({ mailbox: two, id: '11' })).rejects.toThrow(BodyUnavailableError)
    expect(calls.filter((call) => call.startsWith('thread'))).toEqual([`thread ${one} 11`])
  })
})

describe('createLiveInbox scope', () => {
  const full = (mailboxId: string) =>
    Array.from({ length: perMailbox }, (_, index) =>
      listing(mailboxId, String(index + 11), `2026-09-22T09:0${String(index % 10)}:00+02:00`),
    )

  it('reports what was loaded, the bounds and when it was read', async () => {
    const { live } = inbox({
      mailboxes: [access(one), access(two)],
      listings: { [one]: [listing(one, '11', null), listing(one, '12', null)], [two]: [] },
    })
    const result = await live.list()
    if (result.status !== 'ready') throw new Error('Expected a list')

    expect(result.scope).toEqual({
      mailboxes: [
        { id: one, label: one, loaded: 2, bounded: false },
        { id: two, label: two, loaded: 0, bounded: false },
      ],
      readable: 2,
      mailboxLimit: maxMailboxes,
      messageLimit: perMailbox,
      loaded: 2,
      bounded: false,
      readAt: '12:00',
      refreshedAt: '2026-09-22T10:00:00.000Z',
    })
  })

  it('reports a mailbox as bounded when its listing came back at the bound', async () => {
    const { live } = inbox({
      mailboxes: [access(one), access(two)],
      listings: { [one]: full(one), [two]: [listing(two, '21', null)] },
    })
    const result = await live.list()
    if (result.status !== 'ready') throw new Error('Expected a list')

    expect(result.scope.mailboxes.map((mailbox) => mailbox.bounded)).toEqual([true, false])
    expect(result.scope.bounded).toBe(true)
    expect(result.scope.loaded).toBe(perMailbox + 1)
  })

  it('counts the readable mailboxes it left out, so the reading is not read as every mailbox', async () => {
    const readable = Array.from({ length: maxMailboxes + 2 }, (_, index) =>
      access(`box${String(index)}@mail.example`),
    )
    const { live } = inbox({ mailboxes: readable })
    const result = await live.list()
    if (result.status !== 'ready') throw new Error('Expected a list')

    expect(result.scope.readable).toBe(maxMailboxes + 2)
    expect(result.scope.mailboxes).toHaveLength(maxMailboxes)
    expect(result.scope.bounded).toBe(true)
  })

  it('is bounded by the mailbox bound alone, with no listing anywhere near its own bound', async () => {
    // Every loaded mailbox answered with one message, far under the message
    // bound, so only the mailbox bound cut this reading. What the two skipped
    // mailboxes hold is unknown, and may be newer than anything loaded.
    const readable = Array.from({ length: maxMailboxes + 2 }, (_, index) =>
      access(`box${String(index)}@mail.example`),
    )
    const listings = Object.fromEntries(
      readable.map(({ mailbox }) => [mailbox.id, [listing(mailbox.id, '11', null)]]),
    )
    const { live } = inbox({ mailboxes: readable, listings })
    const result = await live.list()
    if (result.status !== 'ready') throw new Error('Expected a list')

    expect(result.scope.bounded).toBe(true)
    expect(result.scope.mailboxes.every((mailbox) => !mailbox.bounded)).toBe(true)
    expect(result.scope.loaded).toBe(maxMailboxes)
    expect(result.scope.readable - result.scope.mailboxes.length).toBe(2)
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
  it('shows the senders and subjects Spark lists, whole or cut', async () => {
    const subject = 'Your monthly statement for account EX-1002 is ready to view online'
    const transport: SparkTransport = (command) =>
      Promise.resolve(
        command.name === 'accounts'
          ? 'Email Account: one@mail.example (Access: read-only)\n'
          : emailsTable([
              [
                '4003',
                'one@mail.example',
                'Sam Customer <sam@a.example>',
                '2026-09-22 09:03',
                'Order EX-1002',
                '',
              ],
              [
                '4002',
                'one@mail.example',
                'Jordan Example <jordan.example@company.example>',
                '2026-09-22 09:02',
                subject,
                '',
              ],
              [
                '4001',
                'one@mail.example',
                'notifications-noreply@monitoring.example',
                '2026-09-22 09:01',
                'Zoë — 注文 🇳🇱',
                '',
              ],
            ]),
      )
    const reader = createSparkMailReader({
      transport,
      timeZone: 'Europe/Amsterdam',
      log: () => undefined,
    })
    const result = await createLiveInbox({ reader, timeZone: 'Europe/Amsterdam', now }).list()
    if (result.status !== 'ready') throw new Error('Expected a list')

    expect(
      result.messages.map(({ sender, address, subject }) => ({ sender, address, subject })),
    ).toEqual([
      { sender: 'Sam Customer', address: 'sam@a.example', subject: 'Order EX-1002' },
      { sender: 'Jordan Example', address: undefined, subject: `${subject.slice(0, 49)}…` },
      { sender: 'notifications-noreply@monitor…', address: undefined, subject: 'Zoë — 注文 🇳🇱' },
    ])
  })

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

    if (result.status !== 'ready') throw new Error('Expected a list')
    // Spark lists message 4001 in each readable mailbox: every copy stays a row.
    expect(result.messages.map(({ messageId, mailbox }) => ({ messageId, mailbox }))).toEqual([
      { messageId: '4001', mailbox: 'Ops@Example.com' },
      { messageId: '4001', mailbox: 'support@example.com' },
      { messageId: '4001', mailbox: 'person@example.org' },
      { messageId: '4001', mailbox: 'other@example.net' },
    ])
    expect(new Set(result.messages.map((message) => message.id)).size).toBe(4)
    expect(body).toEqual({ id: copy('Ops@Example.com', '4001'), text: 'Hello' })
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
