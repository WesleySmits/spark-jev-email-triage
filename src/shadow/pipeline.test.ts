import type { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { createJevClassifier } from '../jev/classifier'
import { JevError } from '../jev/errors'
import { jevResponse, type ResponseOptions } from '../jev/fixtures'
import type { JevTransport } from '../jev/transport'
import { sparkArguments, type SparkCommand } from '../spark/commands'
import { accountsOutput, emailsTable, threadText } from '../spark/fixtures'
import type { SparkTransport } from '../spark/process'
import { createSparkMailReader } from '../spark/reader'
import { openDatabase } from './database'
import { runShadowTriage, type ShadowDeps } from './pipeline'
import { readRun } from './store'

const mailbox = 'support@example.com'
const customer = 'Sam Customer <sam@example.org>'

// Three threads: 4001 alone, 4002 with a reply 4003, and 4004 alone.
const threads: Record<string, string> = {
  '4001': threadText('Where is order EX-4001?', [
    { id: '4001', from: customer, date: '2026-01-12 09:00', body: 'Has my order shipped yet?' },
  ]),
  '4002': threadText('Invoice INV-4002', [
    {
      id: '4002',
      from: 'Billing <billing@vendor.example>',
      date: '2026-01-12 10:00',
      body: 'Invoice attached.',
    },
    {
      id: '4003',
      from: 'Billing <billing@vendor.example>',
      date: '2026-01-12 11:00',
      body: 'Reminder: due Friday.',
    },
  ]),
  '4004': threadText('Following up', [
    {
      id: '4004',
      from: 'Someone <someone@example.net>',
      date: '2026-01-12 12:00',
      body: 'Let me know.',
    },
  ]),
}
threads['4003'] = threads['4002'] ?? ''

const row = (id: string, subject: string) =>
  [id, mailbox, customer, '2026-01-12 12:00', subject, 'unread'] as const

const listing = emailsTable([
  row('4004', 'Following up'),
  row('4003', 'Invoice INV-4002'),
  row('4002', 'Invoice INV-4002'),
  row('4001', 'Where is order EX-4001?'),
])

/** Fake `spark`: answers read-only commands from synthetic output and records every call. */
function fakeSpark(overrides: { emails?: string; thread?: (id: string) => string } = {}) {
  const commands: SparkCommand[] = []
  const transport: SparkTransport = (command) => {
    commands.push(command)
    switch (command.name) {
      case 'accounts':
        return Promise.resolve(accountsOutput)
      case 'emails':
        return Promise.resolve(overrides.emails ?? listing)
      case 'thread':
        return Promise.resolve(
          overrides.thread?.(command.messageId) ?? threads[command.messageId] ?? '',
        )
    }
  }
  const reader = createSparkMailReader({
    transport,
    timeZone: 'Europe/Amsterdam',
    log: () => undefined,
  })
  return { reader, commands }
}

type Answer = ResponseOptions | JevError | Error

/** Fake Jev: answers by thread subject and records concurrency. */
function fakeJev(answer: (subject: string | null) => Answer = () => ({})) {
  const calls: (string | null)[] = []
  let inFlight = 0
  let maxInFlight = 0
  const transport: JevTransport = async (request) => {
    const subject = request.state.email_thread.subject
    calls.push(subject)
    inFlight += 1
    maxInFlight = Math.max(maxInFlight, inFlight)
    await new Promise((resolve) => setTimeout(resolve, 5))
    inFlight -= 1
    const result = answer(subject)
    if (result instanceof Error) throw result
    return jevResponse(result)
  }
  return { classify: createJevClassifier(transport), calls, maxInFlight: () => maxInFlight }
}

function clock() {
  let tick = 0
  return () => new Date(Date.UTC(2026, 0, 13, 8, 0, tick++)).toISOString()
}

const settings = { mailbox, limit: 25, maxJevCalls: 25, jevConcurrency: 2 }

function harness(db: DatabaseSync = openDatabase(':memory:')) {
  const now = clock()
  const run = (
    deps: Partial<Pick<ShadowDeps, 'reader' | 'classify'>> = {},
    overrides: Partial<typeof settings> = {},
  ) =>
    runShadowTriage(
      {
        reader: deps.reader ?? fakeSpark().reader,
        classify: deps.classify === undefined ? fakeJev().classify : deps.classify,
        db,
        now,
      },
      { ...settings, ...overrides },
    )
  return { db, run }
}

const countRow = z.object({ n: z.int() })
const count = (db: DatabaseSync, table: string) =>
  countRow.parse(db.prepare(`SELECT count(*) AS n FROM ${table}`).get()).n

const judgmentRow = z.object({
  thread_id: z.string(),
  status: z.string(),
  review: z.string(),
  rubric: z.string(),
  requested_model: z.string(),
  attempts: z.int(),
  error_code: z.string().nullable(),
})
const judgments = (db: DatabaseSync) =>
  z.array(judgmentRow).parse(db.prepare('SELECT * FROM judgments ORDER BY thread_id, id').all())

describe('runShadowTriage', () => {
  it('classifies each thread once and stores the outcomes', async () => {
    const { db, run } = harness()
    const spark = fakeSpark()
    const jev = fakeJev()

    const summary = await run({ reader: spark.reader, classify: jev.classify })

    expect(summary).toMatchObject({
      mode: 'apply',
      status: 'completed',
      listed: 4,
      classified: 3,
      duplicates: 1,
      skipped: 0,
      providerFailures: 0,
      errorCode: null,
    })
    expect(jev.calls).toHaveLength(3)
    expect(count(db, 'threads')).toBe(3)
    expect(count(db, 'judgments')).toBe(3)
    expect(count(db, 'judgment_messages')).toBe(4)
    expect(readRun(db, summary.runId ?? 0)).toMatchObject({ status: 'completed', classified: 3 })
  })

  it('stores no mail bodies, link tokens, or attachment details', async () => {
    const { db, run } = harness()
    const tokenLink = 'https://shop.example/track?token=9f8e7d6c5b4a39281706f5e4'
    const spark = fakeSpark({
      emails: emailsTable([row('4001', 'Where is order EX-4001?')]),
      thread: () =>
        threadText(`Track it at ${tokenLink}`, [
          { id: '4001', from: customer, date: '2026-01-12 09:00', body: 'Secret body text' },
        ]),
    })
    await run({ reader: spark.reader })

    const dump = JSON.stringify(
      ['runs', 'threads', 'judgments', 'judgment_messages', 'corrections'].map((table) =>
        db.prepare(`SELECT * FROM ${table}`).all(),
      ),
    )
    expect(dump).toContain('Track it at https://shop.example/track')
    expect(dump).toContain('sam@example.org')
    for (const absent of ['Secret body text', '9f8e7d6c5b4a39281706f5e4', 'token=']) {
      expect(dump).not.toContain(absent)
    }
  })

  it('only ever sends read-only Spark commands', async () => {
    const spark = fakeSpark()
    await harness().run({ reader: spark.reader })

    expect(new Set(spark.commands.map((command) => command.name))).toEqual(
      new Set(['accounts', 'emails', 'thread']),
    )
    for (const command of spark.commands) {
      expect(['accounts', 'emails', 'thread']).toContain(sparkArguments(command)[0])
    }
  })

  it('stores an ambiguous classification as needing review', async () => {
    const { db, run } = harness()
    const jev = fakeJev((subject) =>
      subject === 'Following up' ? { category: 'other', categoryShare: 0.4 } : {},
    )

    const summary = await run({ classify: jev.classify })

    expect(summary).toMatchObject({ status: 'completed', needsReview: 1 })
    expect(judgments(db).find((j) => j.thread_id === '4004')).toMatchObject({
      status: 'classified',
      review: 'needs_review',
    })
  })

  it('does no work on a rerun', async () => {
    const { db, run } = harness()
    await run()
    const spark = fakeSpark()
    const jev = fakeJev()

    const summary = await run({ reader: spark.reader, classify: jev.classify })

    expect(summary).toMatchObject({ status: 'completed', skipped: 4, classified: 0 })
    expect(jev.calls).toEqual([])
    expect(spark.commands.map((command) => command.name)).toEqual(['accounts', 'emails'])
    expect(count(db, 'judgments')).toBe(3)
    expect(count(db, 'runs')).toBe(2)
  })

  it.each([
    ['rubric', "UPDATE judgments SET rubric = 'email-triage.v1'"],
    ['model', "UPDATE judgments SET requested_model = 'jev-1.12.0'"],
  ])('judges again after a %s change and keeps the old judgments', async (_, change) => {
    const { db, run } = harness()
    await run()
    db.exec(change)
    const jev = fakeJev()

    const summary = await run({ classify: jev.classify })

    expect(summary).toMatchObject({ status: 'completed', classified: 3 })
    expect(jev.calls).toHaveLength(3)
    expect(count(db, 'judgments')).toBe(6)
  })

  it('judges a thread again when it has a new message', async () => {
    const { db, run } = harness()
    await run()
    const withReply = threadText('Where is order EX-4001?', [
      { id: '4001', from: customer, date: '2026-01-12 09:00', body: 'Has my order shipped yet?' },
      { id: '4005', from: customer, date: '2026-01-12 13:00', body: 'Any news?' },
    ])
    const spark = fakeSpark({
      emails: emailsTable([row('4005', 'Where is order EX-4001?')]),
      thread: () => withReply,
    })

    const summary = await run({ reader: spark.reader })

    expect(summary).toMatchObject({ status: 'completed', classified: 1 })
    expect(judgments(db).filter((j) => j.thread_id === '4001')).toHaveLength(2)
  })

  it('marks a run with provider failures partial and retries them without duplicates', async () => {
    const { db, run } = harness()
    const failing = fakeJev((subject) =>
      subject === 'Invoice INV-4002' ? new JevError('rate_limited', null, 429) : {},
    )

    const first = await run({ classify: failing.classify })

    expect(first).toMatchObject({ status: 'partial', classified: 2, providerFailures: 1 })
    expect(judgments(db).find((j) => j.thread_id === '4002')).toMatchObject({
      status: 'provider_failure',
      review: 'needs_review',
      error_code: 'rate_limited',
    })

    const retry = fakeJev()
    const second = await run({ classify: retry.classify })

    // 4004 and 4001 are covered; 4003 reopens thread 4002, and 4002 is its duplicate.
    expect(second).toMatchObject({ status: 'completed', classified: 1, skipped: 2, duplicates: 1 })
    expect(retry.calls).toEqual(['Invoice INV-4002'])
    expect(judgments(db).find((j) => j.thread_id === '4002')).toMatchObject({
      status: 'classified',
      attempts: 2,
    })
    expect(count(db, 'judgments')).toBe(3)
  })

  it('counts an unreadable thread as a read error and keeps going', async () => {
    const { run } = harness()
    const spark = fakeSpark({
      thread: (id) =>
        id === '4001' ? 'Spark is starting, try again later.\n' : (threads[id] ?? ''),
    })

    expect(await run({ reader: spark.reader })).toMatchObject({
      status: 'partial',
      readErrors: 1,
      classified: 2,
    })
  })

  it('records a failed run when the listing is malformed', async () => {
    const { db, run } = harness()
    const jev = fakeJev()
    const spark = fakeSpark({ emails: 'Emails in support@example.com:Inbox\n' })

    const summary = await run({ reader: spark.reader, classify: jev.classify })

    expect(summary).toMatchObject({ status: 'failed', errorCode: 'spark_malformed_output' })
    expect(readRun(db, summary.runId ?? 0)).toMatchObject({
      status: 'failed',
      error_code: 'spark_malformed_output',
    })
    expect(jev.calls).toEqual([])
    expect(count(db, 'judgments')).toBe(0)
  })

  it('fails without a run when the mailbox is not readable', async () => {
    const { db, run } = harness()

    expect(await run({}, { mailbox: 'archive@example.net' })).toMatchObject({
      status: 'failed',
      errorCode: 'mailbox_unavailable',
      runId: null,
    })
    expect(count(db, 'runs')).toBe(0)
  })

  it('rolls back a failed write and recovers on the next run without duplicates', async () => {
    const { db, run } = harness()
    db.exec(`CREATE TRIGGER fail_4003 BEFORE INSERT ON judgment_messages
             WHEN NEW.message_id = '4003' BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END`)

    const first = await run()

    expect(first).toMatchObject({ status: 'partial', storeErrors: 1, classified: 2 })
    expect(judgments(db).map((j) => j.thread_id)).toEqual(['4001', '4004'])
    expect(count(db, 'threads')).toBe(2)

    db.exec('DROP TRIGGER fail_4003')
    const second = await run()

    expect(second).toMatchObject({ status: 'completed', classified: 1 })
    expect(judgments(db).map((j) => j.thread_id)).toEqual(['4001', '4002', '4004'])
    expect(count(db, 'judgment_messages')).toBe(4)
  })

  it('marks a run left running as interrupted and never as complete', async () => {
    const { db, run } = harness()
    db.exec(`INSERT INTO runs (mailbox_id, rubric, model, status, started_at)
             VALUES ('${mailbox}', 'email-triage.v2', 'jev-1.13.0', 'running', '2026-01-13T07:00:00Z')`)

    const summary = await run()

    expect(summary).toMatchObject({ status: 'completed', interruptedRuns: 1 })
    expect(readRun(db, 1)).toMatchObject({ status: 'interrupted' })
  })

  it('marks the run failed when an unexpected error stops it, then recovers', async () => {
    const { db, run } = harness()
    const broken = fakeJev(() => new TypeError('bug'))

    await expect(run({ classify: broken.classify })).rejects.toThrow(TypeError)
    expect(readRun(db, 1)).toMatchObject({ status: 'failed', error_code: 'unexpected_error' })

    expect(await run()).toMatchObject({ status: 'completed', classified: 3 })
    expect(count(db, 'judgments')).toBe(3)
  })

  it('defers threads beyond the Jev budget and reports the run partial', async () => {
    const { run } = harness()
    const jev = fakeJev()

    const summary = await run({ classify: jev.classify }, { maxJevCalls: 2 })

    expect(summary).toMatchObject({ status: 'partial', classified: 2, deferred: 1 })
    expect(jev.calls).toHaveLength(2)
  })

  it('keeps Jev concurrency within the bound', async () => {
    const jev = fakeJev()
    await harness().run({ classify: jev.classify }, { jevConcurrency: 1 })
    const wider = fakeJev()
    await harness().run({ classify: wider.classify }, { jevConcurrency: 2 })

    expect(jev.maxInFlight()).toBe(1)
    expect(wider.maxInFlight()).toBe(2)
  })

  it('counts work in a dry run without calling Jev or writing anything', async () => {
    const { db, run } = harness()

    const summary = await run({ classify: null })

    expect(summary).toMatchObject({ mode: 'dry', status: 'dry_run', wouldClassify: 3, runId: null })
    expect(count(db, 'runs')).toBe(0)
    expect(count(db, 'judgments')).toBe(0)
  })
})
