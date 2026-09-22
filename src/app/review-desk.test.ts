/**
 * `ReviewDesk` over a mocked Spark and a real, temporary shadow database.
 * Only the things a unit test cannot run are stood in for:
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
 * - `jev/transport` and `jev/classifier`, which stand in only to fail. The
 *   desk must never reach them, and these tests assert that it doesn't.
 *
 * Everything below the hop is real: the shared Spark reader with its
 * parsers, `createLiveInbox` with its mailbox-copy authorization, and the
 * SQLite database judgments are read from. So these tests show that the seam
 * reaches those protections, not only that it calls something.
 * `live-inbox.server.test.ts` owns the read protections themselves and
 * `domain/stored-classification.test.ts` the applicability rules; nothing
 * here restates them.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mailboxCopyId } from '../domain/mailbox-copy'
import { currentTriageRubric } from '../domain/triage'
import { jevModel } from '../jev/questions'
import { databasePathVariable } from '../shadow/config'
import { openDatabase } from '../shadow/database'
import { jevFailure, jevJudgment, storeJudgments, type StoredEntry } from '../shadow/fixtures'
import type { SparkCommand } from '../spark/commands'
import { SparkError } from '../spark/errors'
import { emailsTable, emptyEmailsOutput, threadText } from '../spark/fixtures'
import { ReviewDesk, type DeskView } from './review-desk'

const spark = vi.hoisted(() => ({
  /** Answers one Spark command, or throws as its runner does. */
  run: vi.fn<(command: SparkCommand) => Promise<string>>(),
  /** The app server doesn't answer, as a lost connection looks to the page. */
  unreachable: false,
}))

vi.mock('../spark/process', () => ({
  createProcessTransport: () => (command: SparkCommand) => spark.run(command),
}))

// Reading mail must never classify it. Both stand-ins only fail, so a call
// would break the reading that made it instead of passing unnoticed.
const jev = vi.hoisted(() => ({
  createSdkTransport: vi.fn(() => {
    throw new Error('Reading mail must not reach Jev')
  }),
  createJevClassifier: vi.fn(() => {
    throw new Error('Reading mail must not classify it')
  }),
}))

vi.mock('../jev/transport', () => ({ createSdkTransport: jev.createSdkTransport }))
vi.mock('../jev/classifier', () => ({ createJevClassifier: jev.createJevClassifier }))

/** Rejects as a request that never reached the app server does. */
const lost = () => Promise.reject(new Error('The app server did not answer'))

vi.mock('./live-inbox.functions', async () => {
  const { bodyRequestSchema } = await import('./live-inbox')
  const { deskReading } = await import('./review-desk.server')
  const { sparkInbox } = await import('./spark-inbox.server')
  return {
    getLiveInbox: () => (spark.unreachable ? lost() : deskReading()),
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

/** A disposable directory, so each test reads a database of its own. */
let directory: string
let databasePath: string

beforeEach(() => {
  spark.unreachable = false
  spark.run.mockReset()
  spark.run.mockImplementation(answerSpark(aliased))
  jev.createSdkTransport.mockClear()
  jev.createJevClassifier.mockClear()
  directory = mkdtempSync(join(tmpdir(), 'review-desk-test-'))
  // Nothing is written here until a test stores a judgment, so the desk
  // starts with no database at all.
  databasePath = join(directory, 'shadow.sqlite')
  process.env[databasePathVariable] = databasePath
})

afterEach(() => {
  Reflect.deleteProperty(process.env, databasePathVariable)
  rmSync(directory, { recursive: true, force: true })
})

/** Stores judgments the way one `pnpm shadow --apply` run does. */
function shadowRun(entries: readonly StoredEntry[]) {
  const db = openDatabase(databasePath)
  try {
    storeJudgments(db, entries)
  } finally {
    db.close()
  }
}

/** What the reading holds about its listed rows. */
const classificationsIn = (view: DeskView) => (view.status === 'ready' ? view.classifications : {})

/** What the reading holds about one listed row. */
const classificationOf = (view: DeskView, id: string) => classificationsIn(view)[id]

const listed = (view: DeskView) =>
  view.status === 'ready' ? view.messages.map((row) => row.id) : []

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

describe('ReviewDesk.open, stored classifications', () => {
  it('projects the stored judgment of a row, without sharing it with another mailbox copy', async () => {
    shadowRun([{ mailboxId: one, messageIds: ['11'], classification: jevJudgment('11') }])

    const view = await ReviewDesk.open()

    expect(classificationOf(view, copy(one, '11'))).toMatchObject({
      state: 'current',
      subject: {
        copy: { mailboxId: one, messageId: '11' },
        latestMessageId: '11',
        rubric: currentTriageRubric,
        classifierVersion: jevModel,
      },
      labels: { category: 'personal', priority: 'high', review: 'auto_accepted' },
    })
    // The same message id in the other mailbox is another copy. Nothing here
    // is evidence that one delivery reached both, so the judgment stays put.
    expect(classificationOf(view, copy(two, '11'))).toEqual({ state: 'none' })
    expect(classificationOf(view, copy(one, '12'))).toEqual({ state: 'none' })
  })

  it('reads a judgment of an earlier version of the thread as stale, failed retry or not', async () => {
    shadowRun([
      { mailboxId: one, messageIds: ['11'], classification: jevJudgment('11') },
      {
        mailboxId: one,
        messageIds: ['11', '13'],
        classification: jevFailure('11'),
        judgedAt: '2026-09-21T09:00:00.000Z',
      },
    ])

    expect(classificationOf(await ReviewDesk.open(), copy(one, '11'))).toMatchObject({
      state: 'stale',
      reason: 'newer_message',
      subject: { latestMessageId: '11' },
      labels: { category: 'personal' },
    })
  })

  it('reads a judgment by another classifier build as stale, and keeps its labels', async () => {
    shadowRun([
      {
        mailboxId: one,
        messageIds: ['12'],
        classification: { ...jevJudgment('12'), requestedModel: 'jev-1.12.0' },
      },
    ])

    expect(classificationOf(await ReviewDesk.open(), copy(one, '12'))).toMatchObject({
      state: 'stale',
      reason: 'classifier',
      subject: { classifierVersion: 'jev-1.12.0' },
      labels: { category: 'personal' },
    })
  })

  it('reads a failed attempt as a failure, never as a classification', async () => {
    shadowRun([{ mailboxId: one, messageIds: ['12'], classification: jevFailure('12') }])

    const classification = classificationOf(await ReviewDesk.open(), copy(one, '12'))

    expect(classification).toMatchObject({ state: 'provider_failure', errorCode: 'timeout' })
    expect(classification).not.toHaveProperty('labels')
  })

  it('lists every row as unclassified while no run has stored anything', async () => {
    const view = await ReviewDesk.open()

    expect(listed(view)).toEqual([copy(one, '11'), copy(two, '11'), copy(one, '12')])
    expect(Object.values(classificationsIn(view))).toEqual([
      { state: 'none' },
      { state: 'none' },
      { state: 'none' },
    ])
  })

  it('still lists all mail when the stored judgments cannot be read at all', async () => {
    writeFileSync(databasePath, 'not a database')

    const view = await ReviewDesk.open()

    expect(listed(view)).toEqual([copy(one, '11'), copy(two, '11'), copy(one, '12')])
    expect(classificationOf(view, copy(one, '11'))).toEqual({ state: 'none' })
  })

  it('classifies nothing when the page loads or refreshes', async () => {
    shadowRun([{ mailboxId: one, messageIds: ['11'], classification: jevJudgment('11') }])

    const view = await ReviewDesk.open()
    await ReviewDesk.open()
    await ReviewDesk.focus(view)(copy(one, '11'), { signal })

    expect(jev.createSdkTransport).not.toHaveBeenCalled()
    expect(jev.createJevClassifier).not.toHaveBeenCalled()
    // Listing reads no thread either: only the body of the opened row does.
    expect(commands()).toEqual([
      'accounts',
      'emails',
      'emails',
      'accounts',
      'emails',
      'emails',
      'thread',
    ])
  })
})
