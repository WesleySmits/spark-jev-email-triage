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
const inbox = emailsTable([row('1001')])
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
