/**
 * `ReviewDesk` over a mocked Spark. Only the two things a unit test cannot
 * run are stood in for:
 *
 * - `spark/process`, the subprocess runner, answers with synthetic CLI
 *   output instead of starting Spark.
 * - The RPC hop of `live-inbox.functions.ts` and
 *   `spark-readiness.functions.ts`. TanStack Start rewrites those modules
 *   and their handlers need the Start server runtime, so the stand-in makes
 *   the same calls their handlers make, from this computer, and can fail
 *   like an app server that didn't answer. It covers no more than that hop:
 *   `live-inbox.functions.test.ts` owns the boundary's surface and
 *   `live-inbox.server.test.ts` the loopback gate.
 *
 * Everything below the hop is real: the shared Spark reader with its
 * parsers, and `createLiveInbox` with its mailbox-copy authorization. So
 * these tests show that the seam reaches those protections, not only that
 * it calls something. `live-inbox.server.test.ts` owns the protections
 * themselves; nothing here restates them.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mailboxCopyId } from '../domain/mailbox-copy'
import type { SparkCommand } from '../spark/commands'
import { SparkError } from '../spark/errors'
import { emailsTable, emptyEmailsOutput, threadText } from '../spark/fixtures'
import { ReviewDesk } from './review-desk'

const spark = vi.hoisted(() => ({
  /** Answers one Spark command, or throws as its runner does. */
  run: vi.fn<(command: SparkCommand) => Promise<string>>(),
  /** The app server doesn't answer, as a lost connection looks to the page. */
  unreachable: false,
}))

vi.mock('../spark/process', () => ({
  createProcessTransport: () => (command: SparkCommand) => spark.run(command),
}))

/** Rejects as a request that never reached the app server does. */
const lost = () => Promise.reject(new Error('The app server did not answer'))

vi.mock('./live-inbox.functions', async () => {
  const { bodyRequestSchema } = await import('./live-inbox')
  const { sparkInbox } = await import('./spark-inbox.server')
  return {
    getLiveInbox: () => (spark.unreachable ? lost() : sparkInbox().list()),
    getLiveBody: ({ data, signal }: { data: unknown; signal: AbortSignal }) =>
      spark.unreachable ? lost() : sparkInbox().body(bodyRequestSchema.parse(data), { signal }),
  }
})

vi.mock('./spark-readiness.functions', async () => {
  const { sparkReadiness } = await import('./spark-inbox.server')
  const { readinessFor } = await import('./spark-readiness.server')
  return {
    getSparkReadiness: () => (spark.unreachable ? lost() : readinessFor(true, sparkReadiness)),
  }
})

// Synthetic mail only: every address uses a reserved `.example` domain.
type Row = readonly [id: string, from: string, date: string, subject: string]

type Mail = Readonly<{
  mailboxes: readonly string[]
  emails: Readonly<Record<string, readonly Row[]>>
}>

/** Spark's stdout for one command, from `mail`. */
function answerSpark(mail: Mail) {
  return (command: SparkCommand): Promise<string> => {
    if (command.name === 'accounts') {
      const lines = mail.mailboxes.map((address) => `Email Account: ${address} (Access: read-only)`)
      return Promise.resolve(`${lines.join('\n\n')}\n`)
    }
    if (command.name === 'emails') {
      const rows = mail.emails[command.mailboxId] ?? []
      if (rows.length === 0) return Promise.resolve(emptyEmailsOutput)
      return Promise.resolve(
        emailsTable(
          rows.map(([id, from, date, subject]) => [id, command.mailboxId, from, date, subject, '']),
        ),
      )
    }
    return Promise.resolve(
      threadText('Shared subject', [
        {
          id: command.messageId,
          from: 'sam@mail.example',
          date: '2026-09-22 09:00',
          body: `Body of ${command.messageId}`,
        },
      ]),
    )
  }
}

const one = 'one@mail.example'
const two = 'two@mail.example'
const copy = (mailboxId: string, messageId: string) => mailboxCopyId({ mailboxId, messageId })

const sender = 'Sam <sam@mail.example>'

// One delivery to two aliases, so message 11 is a copy in each mailbox, plus
// a message that only the first mailbox has.
const aliased: Mail = {
  mailboxes: [one, two],
  emails: {
    [one]: [
      ['11', sender, '2026-09-22 09:15', 'Shared subject'],
      ['12', sender, '2026-09-22 08:00', 'Only in one'],
    ],
    [two]: [['11', sender, '2026-09-22 09:15', 'Shared subject']],
  },
}

/** The Spark commands run so far, by name. */
const commands = () => spark.run.mock.calls.map(([command]) => command.name)

/** The message ids Spark was asked for a thread of. */
const threadIds = () =>
  spark.run.mock.calls.flatMap(([command]) =>
    command.name === 'thread' ? [String(command.messageId)] : [],
  )

const { signal } = new AbortController()

beforeEach(() => {
  spark.unreachable = false
  spark.run.mockReset()
  spark.run.mockImplementation(answerSpark(aliased))
})

describe('ReviewDesk.open', () => {
  it('lists a row per mailbox copy, each naming the mailbox it was read in', async () => {
    const view = await ReviewDesk.open()
    if (view.status !== 'ready') throw new Error('Expected a reading')

    expect(view.messages.map(({ id, messageId, mailbox }) => ({ id, messageId, mailbox }))).toEqual(
      [
        { id: copy(one, '11'), messageId: '11', mailbox: one },
        { id: copy(two, '11'), messageId: '11', mailbox: two },
        { id: copy(one, '12'), messageId: '12', mailbox: one },
      ],
    )
    expect(view.mailboxes.map((mailbox) => mailbox.id)).toEqual([one, two])
    expect(threadIds()).toEqual([])
  })

  it('reports Spark as unavailable with a coarse reason, and no mail', async () => {
    spark.run.mockRejectedValue(new SparkError('not_installed'))

    await expect(ReviewDesk.open()).resolves.toEqual({ status: 'unavailable', reason: 'missing' })
  })

  it('reports an app server that did not answer as unreachable, without asking Spark', async () => {
    spark.unreachable = true

    await expect(ReviewDesk.open()).resolves.toEqual({
      status: 'unavailable',
      reason: 'unreachable',
    })
    expect(spark.run).not.toHaveBeenCalled()
  })
})

describe('ReviewDesk.focus', () => {
  it('reads the opened row through its own mailbox, naming the copy it belongs to', async () => {
    const focus = ReviewDesk.focus(await ReviewDesk.open())

    await expect(focus(copy(two, '11'), { signal })).resolves.toEqual({
      id: copy(two, '11'),
      text: 'Body of 11',
    })
    await expect(focus(copy(one, '12'), { signal })).resolves.toEqual({
      id: copy(one, '12'),
      text: 'Body of 12',
    })
    expect(threadIds()).toEqual(['11', '12'])
  })

  it('refuses a row the latest reading no longer lists, without asking Spark for it', async () => {
    // The page still holds the reading from before the refresh.
    const stale = ReviewDesk.focus(await ReviewDesk.open())
    spark.run.mockImplementation(
      answerSpark({ ...aliased, emails: { ...aliased.emails, [two]: [] } }),
    )
    const refreshed = await ReviewDesk.open()
    if (refreshed.status !== 'ready') throw new Error('Expected a reading')
    // The refresh drops the copy the second mailbox lost and keeps the rest.
    expect(refreshed.messages.map((message) => message.id)).toEqual([
      copy(one, '11'),
      copy(one, '12'),
    ])
    spark.run.mockClear()

    await expect(stale(copy(two, '11'), { signal })).rejects.toThrow()
    expect(threadIds()).toEqual([])
    await expect(stale(copy(one, '11'), { signal })).resolves.toMatchObject({ id: copy(one, '11') })
  })

  it('resolves to null for a row the reading never listed, without asking at all', async () => {
    const focus = ReviewDesk.focus(await ReviewDesk.open())
    spark.run.mockClear()

    await expect(focus(copy('three@mail.example', '11'), { signal })).resolves.toBeNull()
    expect(spark.run).not.toHaveBeenCalled()
  })

  it('asks for nothing while there is no reading to focus in', async () => {
    const focus = ReviewDesk.focus({ status: 'unavailable', reason: 'unreachable' })

    await expect(focus(copy(one, '11'), { signal })).resolves.toBeNull()
    expect(spark.run).not.toHaveBeenCalled()
  })
})

describe('ReviewDesk.probe', () => {
  it('says Spark answers without reading any mail', async () => {
    await expect(ReviewDesk.probe(signal)).resolves.toEqual({ status: 'ready' })
    expect(commands()).toEqual(['accounts'])
  })
})

describe('ReviewDesk.workflows', () => {
  it('offers the one workflow live mail has while it is not triaged', () => {
    expect(ReviewDesk.workflows).toEqual([{ id: 'inbox', icon: 'inbox', label: 'Recent mail' }])
  })
})
