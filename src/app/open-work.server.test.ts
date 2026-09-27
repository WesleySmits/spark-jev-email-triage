import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { ListRecentEmailsRequest, MailReader } from '../domain/mail-reader'
import { decideFollowUp } from '../domain/follow-up'
import { openDatabase } from '../shadow/database'
import { recordFollowUp } from '../shadow/follow-ups'
import { inspectCopy, readOpenWork, readWorkMessage } from './open-work.server'

const copy = { mailboxId: 'local@example.test', messageId: 'm1' }
const row = (messageId: string) => ({
  messageId,
  mailboxId: copy.mailboxId,
  from: null,
  sender: null,
  subject: null,
  date: null,
})

function reader(rows: readonly ReturnType<typeof row>[]): MailReader {
  return {
    listMailboxes: vi.fn(() =>
      Promise.resolve([
        {
          mailbox: { id: copy.mailboxId, address: copy.mailboxId },
          kind: 'account' as const,
          canRead: true,
        },
      ]),
    ),
    listRecentEmails: vi.fn(({ filter }: ListRecentEmailsRequest) =>
      Promise.resolve(filter === 'is:unread' ? [...rows] : []),
    ),
    readThread: vi.fn(() =>
      Promise.resolve({
        id: 'thread-1',
        mailboxId: copy.mailboxId,
        subject: null,
        messages: [
          {
            id: 'm1',
            from: { address: 'sender@example.test', name: null },
            to: [],
            cc: [],
            sentAt: null,
            bodyText: null,
            attachments: [],
          },
        ],
      }),
    ),
  }
}

describe('recorded work Spark evidence', () => {
  it('proves a listed copy and its current thread version', async () => {
    expect(await inspectCopy(reader([row('m1')]), copy)).toEqual({
      evidence: { reach: 'listed', view: 'unread' },
      observation: {
        copy,
        observed: 'named',
        threadId: 'thread-1',
        latestMessageId: 'm1',
        proven: true,
      },
    })
  })

  it('does not treat a full bounded page as proof a copy left Inbox', async () => {
    const checked = await inspectCopy(
      reader(Array.from({ length: 25 }, (_, index) => row(`other-${String(index)}`))),
      copy,
    )
    expect(checked).toMatchObject({ evidence: { reach: 'bounded' } })
  })

  it('treats provider failure as unknown', async () => {
    const failing = reader([])
    failing.listRecentEmails = vi.fn(() => Promise.reject(new Error('offline')))
    expect(await inspectCopy(failing, copy)).toEqual({ evidence: { reach: 'unreadable' } })
  })

  it('scans each mailbox once for multiple recorded copies', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'open-work-test-'))
    const path = join(directory, 'work.sqlite')
    try {
      const db = openDatabase(path)
      for (const messageId of ['m1', 'm2']) {
        recordFollowUp(
          db,
          decideFollowUp({
            target: {
              copy: { ...copy, messageId },
              threadId: `thread-${messageId}`,
              latestMessageId: messageId,
            },
            kind: 'reply_needed',
            dueAt: null,
            decidedBy: 'local',
            decidedAt: '2026-09-27T09:00:00.000Z',
          }),
        )
      }
      db.close()
      const mailboxes = vi.fn(() => reader([]).listMailboxes())
      const list = vi.fn(({ filter }: ListRecentEmailsRequest) =>
        Promise.resolve(filter === 'is:unread' ? [row('m1'), row('m2')] : []),
      )
      const provider: MailReader = {
        ...reader([]),
        listMailboxes: mailboxes,
        listRecentEmails: list,
      }
      const reading = await readOpenWork(provider, { SHADOW_DATABASE_PATH: path })
      expect(reading.status).toBe('ready')
      if (reading.status === 'ready') expect(reading.items).toHaveLength(2)
      expect(mailboxes).toHaveBeenCalledOnce()
      expect(list).toHaveBeenCalledTimes(2)
      const selected = await readWorkMessage(provider, { copy }, { SHADOW_DATABASE_PATH: path })
      expect(selected).toMatchObject({
        status: 'ready',
        target: { copy, threadId: 'thread-1', latestMessageId: 'm1' },
      })
      expect(
        await readWorkMessage(
          provider,
          { copy: { ...copy, messageId: 'not-recorded' } },
          { SHADOW_DATABASE_PATH: path },
        ),
      ).toEqual({ status: 'unavailable' })
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('reaches a reply-needed copy older than the first 50 decisions', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'open-work-pages-'))
    const path = join(directory, 'work.sqlite')
    try {
      const db = openDatabase(path)
      for (let index = 0; index < 51; index++) {
        const messageId = `message-${String(index)}`
        recordFollowUp(
          db,
          decideFollowUp({
            target: {
              copy: { ...copy, messageId },
              threadId: `thread-${messageId}`,
              latestMessageId: messageId,
            },
            kind: 'reply_needed',
            dueAt: null,
            decidedBy: 'local',
            decidedAt: '2026-09-27T09:00:00.000Z',
          }),
        )
      }
      db.close()
      const provider = reader([])
      const env = { SHADOW_DATABASE_PATH: path }
      const first = await readOpenWork(provider, env)
      expect(first.status).toBe('ready')
      if (first.status !== 'ready') return
      expect(first.items).toHaveLength(50)
      expect(
        first.tally.open + first.tally.unknown + first.tally.overdue + first.tally.completed,
      ).toBe(50)
      expect(first.nextCursor).not.toBeNull()
      const older = await readOpenWork(provider, env, () => new Date(), first.nextCursor)
      expect(older.status).toBe('ready')
      if (older.status !== 'ready') return
      expect(older.items.map((item) => item.copy.messageId)).toEqual(['message-0'])
      expect(older.items[0]?.history[0]?.kind).toBe('reply_needed')
      expect(older.nextCursor).toBeNull()
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
