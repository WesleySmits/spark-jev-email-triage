import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { proposeMailboxAction } from '../domain/mailbox-action'
import type { SparkDoneProviderPort } from '../spark/done-provider'
import { createDoneActionService } from './done-action.server'

const now = new Date('2026-09-24T09:00:00.000Z')
const proposal = () =>
  proposeMailboxAction({
    kind: 'markAsDone',
    scope: 'spark-message-id',
    targets: [
      {
        copy: { mailboxId: 'support@example.com', messageId: '1001' },
        threadId: '1001',
        latestMessageId: '1001',
      },
    ],
    basis: null,
    proposedAt: '2026-09-24T08:59:00.000Z',
  })

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function harness() {
  const dir = mkdtempSync(join(tmpdir(), 'spark-done-test-'))
  dirs.push(dir)
  const path = join(dir, 'done.sqlite')
  let enabled = true
  let preflight: 'ready' | 'refused' = 'ready'
  let readback: 'confirmed' | 'uncertain' = 'confirmed'
  let writeError: Error | null = null
  let clock = now
  const markAsDone = vi.fn(() =>
    writeError === null ? Promise.resolve() : Promise.reject(writeError),
  )
  const preflightMock = vi.fn(() => Promise.resolve(preflight))
  const readbackMock = vi.fn(() => Promise.resolve(readback))
  const provider: SparkDoneProviderPort = {
    preflight: preflightMock,
    markAsDone,
    readback: readbackMock,
  }
  const service = createDoneActionService({
    provider,
    open: () => new DatabaseSync(path),
    enabled: () => enabled,
    now: () => clock,
    reviewer: () => 'local reviewer',
  })
  return {
    service,
    provider,
    markAsDone,
    preflightMock,
    readbackMock,
    path,
    disable: () => {
      enabled = false
    },
    refusePreflight: () => {
      preflight = 'refused'
    },
    uncertainReadback: () => {
      readback = 'uncertain'
    },
    failWrite: () => {
      writeError = new Error('private Spark stderr')
    },
    advance: () => {
      clock = new Date(now.getTime() + 6 * 60_000)
    },
  }
}

describe('server-owned Done action', () => {
  it('stays off by default and reaches no provider or journal', async () => {
    const h = harness()
    h.disable()
    expect(await h.service.approve({ proposal: proposal() })).toEqual({
      status: 'blocked',
      reason: 'disabled',
    })
    expect(h.preflightMock).not.toHaveBeenCalled()
    expect(h.markAsDone).not.toHaveBeenCalled()
  })

  it('persists a server-created approval, claims before one write, then confirms readback', async () => {
    const h = harness()
    const proposed = proposal()
    const approved = await h.service.approve({ proposal: proposed })
    expect(approved.status).toBe('approved')
    if (approved.status !== 'approved') return
    expect(approved.approval).toMatchObject({
      approvedBy: 'local reviewer',
      approvedAt: now.toISOString(),
    })
    const key = randomUUID()
    expect(
      await h.service.execute({
        proposal: proposed,
        approval: approved.approval,
        idempotencyKey: key,
      }),
    ).toEqual({ status: 'confirmed' })
    expect(h.markAsDone).toHaveBeenCalledExactlyOnceWith('1001')
    const db = new DatabaseSync(h.path, { readOnly: true })
    expect(db.prepare('SELECT status FROM mailbox_action_receipts').get()?.['status']).toBe(
      'confirmed',
    )
    expect(
      db.prepare('SELECT approved_by FROM mailbox_action_approvals').get()?.['approved_by'],
    ).toBe('local reviewer')
    db.close()
    expect(
      await h.service.execute({
        proposal: proposed,
        approval: approved.approval,
        idempotencyKey: key,
      }),
    ).toEqual({ status: 'blocked', reason: 'replay' })
    expect(h.markAsDone).toHaveBeenCalledTimes(1)
  })

  it('commits the pending receipt before the provider receives the action', async () => {
    const h = harness()
    const proposed = proposal()
    const approved = await h.service.approve({ proposal: proposed })
    if (approved.status !== 'approved') throw new Error('Expected approval')
    const seen: unknown[] = []
    h.provider.markAsDone = () => {
      const db = new DatabaseSync(h.path, { readOnly: true })
      seen.push(db.prepare('SELECT status FROM mailbox_action_receipts').get()?.['status'])
      db.close()
      return Promise.resolve()
    }
    expect(
      await h.service.execute({
        proposal: proposed,
        approval: approved.approval,
        idempotencyKey: randomUUID(),
      }),
    ).toEqual({ status: 'confirmed' })
    expect(seen).toEqual(['pending'])
  })

  it('rejects an approval invented in the browser and an expired approval', async () => {
    const h = harness()
    const proposed = proposal()
    const approved = await h.service.approve({ proposal: proposed })
    if (approved.status !== 'approved') throw new Error('Expected approval')
    expect(
      await h.service.execute({
        proposal: proposed,
        approval: { ...approved.approval, approvedBy: 'imposter' },
        idempotencyKey: randomUUID(),
      }),
    ).toEqual({ status: 'blocked', reason: 'approval' })
    h.advance()
    expect(
      await h.service.execute({
        proposal: proposed,
        approval: approved.approval,
        idempotencyKey: randomUUID(),
      }),
    ).toEqual({ status: 'blocked', reason: 'approval' })
    expect(h.markAsDone).not.toHaveBeenCalled()
  })

  it('rechecks the thread before claiming a receipt', async () => {
    const h = harness()
    const proposed = proposal()
    const approved = await h.service.approve({ proposal: proposed })
    if (approved.status !== 'approved') throw new Error('Expected approval')
    h.refusePreflight()
    expect(
      await h.service.execute({
        proposal: proposed,
        approval: approved.approval,
        idempotencyKey: randomUUID(),
      }),
    ).toEqual({ status: 'blocked', reason: 'preflight' })
    const db = new DatabaseSync(h.path, { readOnly: true })
    expect(
      db.prepare('SELECT count(*) AS count FROM mailbox_action_receipts').get()?.['count'],
    ).toBe(0)
    db.close()
    expect(h.markAsDone).not.toHaveBeenCalled()
  })

  it('reads back after a failed CLI call and confirms only the observed final state', async () => {
    const h = harness()
    h.failWrite()
    const proposed = proposal()
    const approved = await h.service.approve({ proposal: proposed })
    if (approved.status !== 'approved') throw new Error('Expected approval')
    expect(
      await h.service.execute({
        proposal: proposed,
        approval: approved.approval,
        idempotencyKey: randomUUID(),
      }),
    ).toEqual({ status: 'confirmed' })
    expect(h.readbackMock).toHaveBeenCalledTimes(1)
    expect(h.markAsDone).toHaveBeenCalledTimes(1)
  })

  it('keeps uncertain attempts terminal across journal reopen and different keys', async () => {
    const h = harness()
    h.failWrite()
    h.uncertainReadback()
    const proposed = proposal()
    const approved = await h.service.approve({ proposal: proposed })
    if (approved.status !== 'approved') throw new Error('Expected approval')
    const first = randomUUID()
    const request = { proposal: proposed, approval: approved.approval, idempotencyKey: first }
    expect(await h.service.execute(request)).toEqual({ status: 'uncertain' })
    expect(await h.service.execute(request)).toEqual({ status: 'blocked', reason: 'replay' })
    expect(await h.service.execute({ ...request, idempotencyKey: randomUUID() })).toEqual({
      status: 'blocked',
      reason: 'conflict',
    })
    const db = new DatabaseSync(h.path, { readOnly: true })
    expect(db.prepare('SELECT status FROM mailbox_action_receipts').get()?.['status']).toBe(
      'uncertain',
    )
    db.close()
    expect(h.markAsDone).toHaveBeenCalledTimes(1)
  })

  it('serializes two simultaneous executions and permits only one write', async () => {
    const h = harness()
    const proposed = proposal()
    const approved = await h.service.approve({ proposal: proposed })
    if (approved.status !== 'approved') throw new Error('Expected approval')
    let started!: () => void
    let release!: () => void
    const writing = new Promise<void>((resolve) => {
      release = resolve
    })
    const entered = new Promise<void>((resolve) => {
      started = resolve
    })
    const write = vi.fn(() => {
      started()
      return writing
    })
    h.provider.markAsDone = write
    const request = {
      proposal: proposed,
      approval: approved.approval,
      idempotencyKey: randomUUID(),
    }
    const first = h.service.execute(request)
    const second = h.service.execute(request)
    await entered
    expect(write).toHaveBeenCalledTimes(1)
    expect(h.preflightMock).toHaveBeenCalledTimes(2)
    release()
    expect(await Promise.all([first, second])).toEqual([
      { status: 'confirmed' },
      { status: 'blocked', reason: 'replay' },
    ])
    expect(write).toHaveBeenCalledTimes(1)
  })

  it('refuses memory-only journals before a mailbox action', async () => {
    const h = harness()
    const service = createDoneActionService({
      provider: h.provider,
      open: () => new DatabaseSync(':memory:'),
      enabled: () => true,
      now: () => now,
      reviewer: () => 'local reviewer',
    })
    expect(await service.approve({ proposal: proposal() })).toEqual({
      status: 'blocked',
      reason: 'journal_unavailable',
    })
    expect(h.markAsDone).not.toHaveBeenCalled()
  })
})
