/**
 * Recording work decisions against a real, temporary shadow database, and
 * reading the whole list back after the process that wrote it closed it.
 * Nothing is stood in for below the write: the domain's admission rule, the
 * append-only tables and their triggers are all the real ones.
 *
 * `shadow/follow-ups.test.ts` owns the store and `domain/follow-up.test.ts`
 * the admission rule. What is tested here is what this module decides: where
 * the database is, who decided and when, that a store is never created or
 * migrated by a decision, and that nothing reaches a provider.
 */
import { randomUUID } from 'node:crypto'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { databasePathVariable } from '../shadow/config'
import { openDatabase } from '../shadow/database'
import type { WorkDecisionRequest } from './open-work'
import { readRecordedWork, storeWorkDecision } from './open-work.server'
import { localReviewer } from './reviews.server'

// `spark/process` is the only module that starts a process. Recording work
// must never reach it, and a started process would show up here all the same.
const spawned = vi.hoisted(() => vi.fn())
vi.mock('node:child_process', () => ({ spawn: spawned }))

// Synthetic mail only: every address uses a reserved `.example` domain.
const studio = 'studio@mail.example'
const alias = 'alias@mail.example'

const request = (
  kind: WorkDecisionRequest['kind'],
  options: Readonly<{ mailboxId?: string; dueAt?: string | null; requestId?: string }> = {},
): WorkDecisionRequest => ({
  requestId: options.requestId ?? randomUUID(),
  kind,
  target: {
    copy: { mailboxId: options.mailboxId ?? studio, messageId: '11' },
    threadId: 't-11',
    latestMessageId: '11',
  },
  dueAt: options.dueAt ?? null,
})

const at = (iso: string) => () => new Date(iso)

let directory: string
let databasePath: string
let env: Record<string, string | undefined>

beforeEach(() => {
  spawned.mockReset()
  directory = mkdtempSync(join(tmpdir(), 'open-work-server-test-'))
  databasePath = join(directory, 'shadow.sqlite')
  env = { [databasePathVariable]: databasePath }
})

afterEach(() => {
  rmSync(directory, { recursive: true, force: true })
})

/** A store at the current schema, as one `pnpm shadow --apply` leaves it. */
function existingStore() {
  openDatabase(databasePath).close()
}

describe('storeWorkDecision', () => {
  it('records a follow-up with its date, naming this computer and this moment', () => {
    existingStore()
    const dueAt = '2026-10-02T11:00:00+02:00'
    expect(
      storeWorkDecision(request('follow_up_later', { dueAt }), env, at('2026-09-27T09:15:00.000Z')),
    ).toEqual({ status: 'recorded' })

    const read = readRecordedWork(env, at('2026-09-27T09:16:00.000Z'))
    expect(read).toMatchObject({ status: 'ready', bounded: false })
    if (read.status !== 'ready') return
    expect(read.copies).toHaveLength(1)
    expect(read.copies[0]?.decisions[0]).toEqual({
      target: request('reply_needed').target,
      kind: 'follow_up_later',
      dueAt: '2026-10-02T09:00:00.000Z',
      decidedBy: localReviewer(),
      decidedAt: '2026-09-27T09:15:00.000Z',
    })
    expect(spawned).not.toHaveBeenCalled()
  })

  it('records handled in Spark as a claim and runs no Spark command for it', () => {
    existingStore()
    expect(storeWorkDecision(request('handled_in_spark'), env)).toEqual({ status: 'recorded' })
    expect(spawned).not.toHaveBeenCalled()
  })

  it('reopens only what was closed, and says so where nothing was', () => {
    existingStore()
    expect(storeWorkDecision(request('reopen'), env)).toEqual({
      status: 'refused',
      reason: 'nothing_to_reopen',
    })
    expect(storeWorkDecision(request('handled_in_spark'), env)).toEqual({ status: 'recorded' })
    expect(storeWorkDecision(request('reopen'), env)).toEqual({ status: 'recorded' })

    const read = readRecordedWork(env)
    if (read.status !== 'ready') throw new Error('expected a readable store')
    expect(read.copies[0]?.decisions.map(({ kind }) => kind)).toEqual([
      'reopen',
      'handled_in_spark',
    ])
  })

  it('records a retry under one Save id once', () => {
    existingStore()
    const once = request('reply_needed')
    expect(storeWorkDecision(once, env)).toEqual({ status: 'recorded' })
    expect(storeWorkDecision(once, env)).toEqual({ status: 'recorded' })
    const read = readRecordedWork(env)
    if (read.status !== 'ready') throw new Error('expected a readable store')
    expect(read.copies[0]?.decisions).toHaveLength(1)
  })

  it('keeps a delivery to an address and an alias as two copies with their own work', () => {
    existingStore()
    expect(storeWorkDecision(request('reply_needed'), env)).toEqual({ status: 'recorded' })
    expect(storeWorkDecision(request('handled_in_spark', { mailboxId: alias }), env)).toEqual({
      status: 'recorded',
    })
    const read = readRecordedWork(env)
    if (read.status !== 'ready') throw new Error('expected a readable store')
    expect(read.copies.map(({ copy, decisions }) => [copy.mailboxId, decisions[0]?.kind])).toEqual([
      [alias, 'handled_in_spark'],
      [studio, 'reply_needed'],
    ])
  })

  it('refuses a due date on a kind that takes none, storing nothing', () => {
    existingStore()
    expect(
      storeWorkDecision(request('handled_in_spark', { dueAt: '2026-10-02T09:00:00Z' }), env),
    ).toEqual({ status: 'failed' })
    expect(readRecordedWork(env)).toMatchObject({ status: 'ready', copies: [] })
  })

  it('never creates or migrates a store to hold a decision', () => {
    expect(storeWorkDecision(request('reply_needed'), env)).toEqual({ status: 'failed' })
    expect(existsSync(databasePath)).toBe(false)
  })
})

describe('readRecordedWork', () => {
  it('says nothing was ever recorded where no store exists', () => {
    expect(readRecordedWork(env)).toEqual({ status: 'absent' })
    expect(existsSync(databasePath)).toBe(false)
  })

  it('says unavailable, never empty, where the store cannot be read', () => {
    env = { [databasePathVariable]: directory }
    expect(readRecordedWork(env)).toEqual({ status: 'unavailable' })
  })
})
