import { describe, expect, it, vi } from 'vitest'
import type { ActionTarget } from '../domain/mailbox-action'
import { SparkError } from './errors'
import { emailsTable, threadText } from './fixtures'
import { createSparkDoneProvider, type SparkDoneCliTransport } from './done-provider'

const mailboxId = 'support@example.com'
const target: ActionTarget = {
  copy: { mailboxId, messageId: '1001' },
  threadId: '1001',
  latestMessageId: '1001',
}
const row = (id: string) =>
  [id, mailboxId, 'Person <person@example.org>', '2026-01-10 12:05', 'Example', ''] as const
const inbox = emailsTable([row('1001')]).replace(
  'Page 1 of 4 (4 total emails)',
  'Page 1 of 1 (1 total emails)',
)
const archive = inbox.replace('support@example.com:Inbox', 'support@example.com:Archive')
const empty = `Emails in ${mailboxId}:Inbox\n\nNo emails found.`
const emptyArchive = `Emails in ${mailboxId}:Archive\n\nNo emails found.`
const thread = threadText('Example', [
  { id: '1001', from: 'person@example.org', date: '2026-01-10 12:05', body: 'Example' },
])
const accounts = `Email Account: ${mailboxId} (Access: triage)`

function provider(outputs: Record<string, string | Error>, limit = 100) {
  const calls: string[][] = []
  const transport: SparkDoneCliTransport = vi.fn((args: readonly string[]) => {
    calls.push([...args])
    const result = outputs[args.join(' ')]
    if (result instanceof Error) return Promise.reject(result)
    if (result === undefined) return Promise.reject(new Error('Unexpected fake call'))
    return Promise.resolve(result)
  })
  return { done: createSparkDoneProvider({ transport, timeZone: 'UTC', limit }), calls }
}

const accountsCall = 'accounts'
const inboxCall = 'emails --page-size 100 --order descending -- support@example.com:Inbox'
const archiveCall = 'emails --page-size 100 --order descending -- support@example.com:Archive'
const threadCall = 'thread -- 1001'
const actionCall = 'action markAsDone 1001'
const pagedCall = (folder: 'Inbox' | 'Archive', page: number, limit = 2) =>
  `emails --page-size ${String(limit)}${page === 1 ? '' : ` --page ${String(page)}`} --order descending -- ${mailboxId}:${folder}`
const pageOutput = (
  folder: 'Inbox' | 'Archive',
  ids: readonly string[],
  page: number,
  pages: number,
  total: number,
) =>
  emailsTable(ids.map(row))
    .replace(`${mailboxId}:Inbox`, `${mailboxId}:${folder}`)
    .replace(
      /Page 1 of 4 \([0-9]+ total emails\)/,
      `Page ${String(page)} of ${String(pages)} (${String(total)} total emails)`,
    )
const approximatePage = (
  folder: 'Inbox' | 'Archive',
  ids: readonly string[],
  page: number,
  pages: number,
  total: number,
) =>
  pageOutput(folder, ids, page, pages, total).replace(
    /Page ([0-9]+) of ([0-9]+) \(([0-9]+) total emails\)/,
    'Page $1 of $2+ ($3+ total emails)',
  )

describe('Spark Done provider', () => {
  it('checks triage access, the originating Inbox and exact thread version before action', async () => {
    const { done, calls } = provider({
      [accountsCall]: accounts,
      [inboxCall]: inbox,
      [threadCall]: thread,
    })
    expect(await done.preflight(target)).toBe('ready')
    expect(calls.map((args) => args.join(' '))).toEqual([accountsCall, inboxCall, threadCall])
    expect(calls.some((args) => args[0] === 'action')).toBe(false)
  })

  it('refuses when triage access or bounded Inbox membership is missing', async () => {
    const readOnly = provider({ [accountsCall]: `Email Account: ${mailboxId} (Access: read-only)` })
    expect(await readOnly.done.preflight(target)).toBe('refused')
    expect(readOnly.calls).toHaveLength(1)

    const missing = provider({ [accountsCall]: accounts, [inboxCall]: empty })
    expect(await missing.done.preflight(target)).toBe('refused')
  })

  it('refuses a changed thread without calling action', async () => {
    const changed = threadText('Example', [
      { id: '1001', from: 'person@example.org', date: '2026-01-10 12:05', body: 'Example' },
      { id: '1002', from: 'person@example.org', date: '2026-01-10 12:06', body: 'Later' },
    ])
    const { done, calls } = provider({
      [accountsCall]: accounts,
      [inboxCall]: inbox,
      [threadCall]: changed,
    })
    expect(await done.preflight(target)).toBe('refused')
    expect(calls.some((args) => args[0] === 'action')).toBe(false)
  })

  it('sends exactly one id to markAsDone and never retries a failed write', async () => {
    const { done, calls } = provider({ [actionCall]: new Error('private account details') })
    await expect(done.markAsDone('1001')).rejects.toMatchObject({
      code: 'exit_failure',
      message: 'Spark exited with an error',
    })
    expect(calls).toEqual([['action', 'markAsDone', '1001']])
  })

  it('rejects invalid ids and mailbox addresses before any call', async () => {
    const { done, calls } = provider({})
    await expect(done.markAsDone('--all')).rejects.toBeInstanceOf(SparkError)
    await expect(
      done.preflight({ ...target, copy: { mailboxId: 'x; echo leak', messageId: '1001' } }),
    ).rejects.toBeInstanceOf(SparkError)
    await expect(
      done.readback({ ...target, latestMessageId: '1002; echo leak' }),
    ).rejects.toBeInstanceOf(SparkError)
    expect(calls).toHaveLength(0)
  })

  it('confirms only when Archive shows the id and a bounded Inbox page proves absence', async () => {
    const { done, calls } = provider({ [archiveCall]: archive, [inboxCall]: empty })
    expect(await done.readback(target)).toBe('confirmed')
    expect(calls.map((args) => args.join(' '))).toEqual([archiveCall, inboxCall])
  })

  it('keeps missing, still-in-Inbox and full-page evidence uncertain', async () => {
    const noArchive = provider({ [archiveCall]: emptyArchive })
    expect(await noArchive.done.readback(target)).toBe('uncertain')

    const stillThere = provider({ [archiveCall]: archive, [inboxCall]: inbox })
    expect(await stillThere.done.readback(target)).toBe('uncertain')

    const small = createSparkDoneProvider({
      transport: (args) =>
        Promise.resolve(args.at(-1)?.endsWith(':Archive') ? archive : emailsTable([row('2001')])),
      timeZone: 'UTC',
      limit: 1,
    })
    expect(await small.readback(target)).toBe('uncertain')
  })

  it('confirms after finding Archive on page two and exhausting every Inbox page', async () => {
    const outputs = {
      [pagedCall('Archive', 1)]: pageOutput('Archive', ['2001', '2002'], 1, 2, 3),
      [pagedCall('Archive', 2)]: pageOutput('Archive', ['1001'], 2, 2, 3),
      [pagedCall('Inbox', 1)]: pageOutput('Inbox', ['3001', '3002'], 1, 2, 3),
      [pagedCall('Inbox', 2)]: pageOutput('Inbox', ['3003'], 2, 2, 3),
    }
    const { done, calls } = provider(outputs, 2)
    expect(await done.readback(target)).toBe('confirmed')
    expect(calls.map((args) => args.join(' '))).toEqual(Object.keys(outputs))
    expect(calls.some((args) => args[0] === 'action')).toBe(false)
  })

  it('accepts an observed Archive id with Spark’s approximate 10+ footer', async () => {
    const archiveIds = ['1001', ...Array.from({ length: 99 }, (_, index) => String(index + 2001))]
    const { done, calls } = provider({
      [archiveCall]: approximatePage('Archive', archiveIds, 1, 10, 1000),
      [inboxCall]: empty,
    })
    expect(await done.readback(target)).toBe('confirmed')
    expect(calls.map((args) => args.join(' '))).toEqual([archiveCall, inboxCall])
    expect(calls.some((args) => args[0] === 'action')).toBe(false)
  })

  it('can find Archive on a later approximate page', async () => {
    const { done, calls } = provider(
      {
        [pagedCall('Archive', 1, 1)]: approximatePage('Archive', ['2001'], 1, 10, 10),
        [pagedCall('Archive', 2, 1)]: approximatePage('Archive', ['1001'], 2, 10, 10),
        [pagedCall('Inbox', 1, 1)]: empty,
      },
      1,
    )
    expect(await done.readback(target)).toBe('confirmed')
    expect(calls).toHaveLength(3)
  })

  it('cannot prove absence from an approximate listing within the 20-page bound', async () => {
    const outputs: Record<string, string> = {
      [pagedCall('Archive', 1, 1)]: pageOutput('Archive', ['1001'], 1, 1, 1),
    }
    for (let page = 1; page <= 20; page += 1) {
      outputs[pagedCall('Inbox', page, 1)] = approximatePage(
        'Inbox',
        [String(page + 3000)],
        page,
        10,
        10,
      )
    }
    const { done, calls } = provider(outputs, 1)
    expect(await done.readback(target)).toBe('uncertain')
    expect(calls).toHaveLength(21)
    expect(calls.some((args) => args[0] === 'action')).toBe(false)
  })

  it('stays uncertain when the target is still on a later Inbox page', async () => {
    const { done, calls } = provider(
      {
        [pagedCall('Archive', 1)]: pageOutput('Archive', ['1001'], 1, 1, 1),
        [pagedCall('Inbox', 1)]: pageOutput('Inbox', ['3001', '3002'], 1, 2, 3),
        [pagedCall('Inbox', 2)]: pageOutput('Inbox', ['1001'], 2, 2, 3),
      },
      2,
    )
    expect(await done.readback(target)).toBe('uncertain')
    expect(calls.some((args) => args[0] === 'action')).toBe(false)
  })

  it('fails closed when the advertised page count exceeds the hard bound', async () => {
    const { done, calls } = provider(
      {
        [pagedCall('Archive', 1, 1)]: pageOutput('Archive', ['1001'], 1, 1, 1),
        [pagedCall('Inbox', 1, 1)]: pageOutput('Inbox', ['3001'], 1, 21, 21),
      },
      1,
    )
    expect(await done.readback(target)).toBe('uncertain')
    expect(calls).toHaveLength(2)
  })

  it('does not treat a header without an empty-state marker as an empty Inbox', async () => {
    const { done } = provider({
      [archiveCall]: archive,
      [inboxCall]: `Emails in ${mailboxId}:Inbox`,
    })
    expect(await done.readback(target)).toBe('uncertain')
  })

  it('fails closed on repeated ids, changed totals, malformed pages, and transport errors', async () => {
    const archivePage = pageOutput('Archive', ['1001'], 1, 1, 1)
    const firstInbox = pageOutput('Inbox', ['3001', '3002'], 1, 2, 3)
    const invalidSecondPages = [
      pageOutput('Inbox', ['3001'], 2, 2, 3),
      pageOutput('Inbox', ['3003'], 2, 2, 4),
      pageOutput('Inbox', ['3003'], 1, 2, 3),
      pageOutput('Inbox', ['3003'], 2, 2, 3).replace(
        `${mailboxId}:Inbox`,
        `${mailboxId}:Inbox (filter: newer_than:1d)`,
      ),
      new Error('private mailbox details'),
    ]
    for (const second of invalidSecondPages) {
      const { done, calls } = provider(
        {
          [pagedCall('Archive', 1)]: archivePage,
          [pagedCall('Inbox', 1)]: firstInbox,
          [pagedCall('Inbox', 2)]: second,
        },
        2,
      )
      expect(await done.readback(target)).toBe('uncertain')
      expect(calls.some((args) => args[0] === 'action')).toBe(false)
    }
  })

  it('returns uncertain on a sensitive readback error without exposing its text', async () => {
    const { done } = provider({ [archiveCall]: new Error('private subject and mailbox') })
    expect(await done.readback(target)).toBe('uncertain')
  })

  it('does not accept an Inbox table as Archive proof', async () => {
    const { done, calls } = provider({ [archiveCall]: inbox })
    expect(await done.readback(target)).toBe('uncertain')
    expect(calls).toHaveLength(1)
  })
})
