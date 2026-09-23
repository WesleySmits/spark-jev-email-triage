import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  approveProposal,
  proposeMailboxAction,
  type ActionTarget,
  type MailboxActionProposal,
} from '../domain/mailbox-action'
import type { MailboxCopyRef } from '../domain/mailbox-copy'
import { runGuardedMarkAsSeen, type ExactCopySeenProvider } from './mark-as-seen'
import { createActionReceiptStore } from './receipt-store'

const copy = { mailboxId: 'studio@mail.example', messageId: 'm-1' }
const alias = { mailboxId: 'alias@mail.example', messageId: 'm-1' }
const proposedAt = '2026-09-23T10:00:00.000Z'
const approvedAt = '2026-09-23T10:01:00.000Z'
const now = '2026-09-23T10:02:00.000Z'

function proposal(targets = [{ copy, threadId: 't-1', latestMessageId: 'm-1' }]) {
  return proposeMailboxAction({ kind: 'markAsSeen', targets, basis: null, proposedAt })
}

class FakeProvider implements ExactCopySeenProvider {
  current = { copy, threadId: 't-1', latestMessageId: 'm-1', unread: true }
  scope: 'exact-mailbox-copy' | 'unproven' = 'exact-mailbox-copy'
  conditionalVersion = true
  moveBeforeWrite = false
  failWrite = false
  failReadAfterWrite = false
  wrongReadAfterWrite = false
  writes: MailboxCopyRef[] = []
  capabilityCalls = 0
  readCalls = 0

  capability() {
    this.capabilityCalls += 1
    if (this.scope === 'unproven') return Promise.resolve(null)
    return Promise.resolve({
      copy: this.current.copy,
      action: 'markAsSeen' as const,
      scope: this.scope,
      conditionalVersion: this.conditionalVersion,
    })
  }

  read() {
    this.readCalls += 1
    if (this.failReadAfterWrite && this.writes.length > 0) {
      return Promise.reject(new Error('mail contents must not leak'))
    }
    if (this.wrongReadAfterWrite && this.writes.length > 0) {
      return Promise.resolve({ ...this.current, copy: alias })
    }
    return Promise.resolve(this.current)
  }

  markAsSeen(target: ActionTarget) {
    if (this.moveBeforeWrite) this.current = { ...this.current, latestMessageId: 'm-2' }
    if (
      this.current.copy.mailboxId !== target.copy.mailboxId ||
      this.current.copy.messageId !== target.copy.messageId ||
      this.current.threadId !== target.threadId ||
      this.current.latestMessageId !== target.latestMessageId
    )
      return Promise.reject(new Error('conditional version mismatch'))
    this.writes.push(target.copy)
    this.current = { ...this.current, unread: false }
    if (this.failWrite) return Promise.reject(new Error('unknown provider result'))
    return Promise.resolve()
  }
}

const open = new Set<DatabaseSync>()
const dirs = new Set<string>()
afterEach(() => {
  for (const db of open) db.close()
  open.clear()
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
  dirs.clear()
})

function harness() {
  const dir = mkdtempSync(join(tmpdir(), 'spark-action-'))
  dirs.add(dir)
  const db = new DatabaseSync(join(dir, 'receipts.sqlite'))
  open.add(db)
  const receipts = createActionReceiptStore(db)
  const provider = new FakeProvider()
  const proposed = proposal()
  const approval = approveProposal(proposed, { approvedBy: 'local reviewer', approvedAt })
  let enabled = true
  const dependencies = {
    provider,
    receipts,
    verifyApproval: () => Promise.resolve(true),
    enabled: () => enabled,
    now: () => new Date(now),
  }
  const request = { proposal: proposed, approval, idempotencyKey: 'attempt-1' }
  return {
    db,
    provider,
    receipts,
    request,
    dependencies,
    disable: () => {
      enabled = false
    },
  }
}

describe('guarded markAsSeen', () => {
  it('confirms only after the exact copy reads back as seen', async () => {
    const h = harness()
    expect(await runGuardedMarkAsSeen(h.request, h.dependencies)).toEqual({ status: 'confirmed' })
    expect(h.provider.writes).toEqual([copy])
    expect(h.receipts.status('attempt-1')).toBe('confirmed')
    const receipt = h.db
      .prepare('SELECT readback_at, readback_hash FROM mailbox_action_receipts')
      .get()
    expect(receipt?.['readback_at']).toBe(now)
    expect(receipt?.['readback_hash']).toMatch(/^[a-f0-9]{64}$/)
  })

  it('does not accept more than one named copy', async () => {
    const h = harness()
    const both = proposal([
      { copy, threadId: 't-1', latestMessageId: 'm-1' },
      { copy: alias, threadId: 't-1', latestMessageId: 'm-1' },
    ])
    const result = await runGuardedMarkAsSeen(
      {
        ...h.request,
        proposal: both,
        approval: approveProposal(both, { approvedBy: 'local reviewer', approvedAt }),
      },
      h.dependencies,
    )
    expect(result).toEqual({ status: 'blocked', reason: 'invalid_scope' })
    expect(h.provider.writes).toEqual([])
  })

  it('rejects an unsupported action at the runtime boundary', async () => {
    const h = harness()
    const unsupported = {
      ...h.request.proposal,
      kind: 'archive',
    } as unknown as MailboxActionProposal
    expect(
      await runGuardedMarkAsSeen({ ...h.request, proposal: unsupported }, h.dependencies),
    ).toEqual({
      status: 'blocked',
      reason: 'invalid_scope',
    })
    expect(h.provider.writes).toEqual([])
  })

  it('blocks when copy-only provider capability is unproven', async () => {
    const h = harness()
    h.provider.scope = 'unproven'
    expect(await runGuardedMarkAsSeen(h.request, h.dependencies)).toEqual({
      status: 'blocked',
      reason: 'invalid_scope',
    })
    expect(h.provider.writes).toEqual([])
  })

  it('requires atomic conditional-version capability', async () => {
    const h = harness()
    h.provider.conditionalVersion = false
    expect(await runGuardedMarkAsSeen(h.request, h.dependencies)).toEqual({
      status: 'blocked',
      reason: 'invalid_scope',
    })
    expect(h.provider.writes).toEqual([])
  })

  it('rejects an approval of a newly minted proposal', async () => {
    const h = harness()
    const later = proposeMailboxAction({
      ...h.request.proposal,
      proposedAt: '2026-09-23T10:00:01.000Z',
    })
    expect(await runGuardedMarkAsSeen({ ...h.request, proposal: later }, h.dependencies)).toEqual({
      status: 'blocked',
      reason: 'approval',
    })
    expect(h.provider.writes).toEqual([])
  })

  it('rejects an approval older than five minutes', async () => {
    const h = harness()
    const old = approveProposal(h.request.proposal, {
      approvedBy: 'local reviewer',
      approvedAt: '2026-09-23T10:00:00.000Z',
    })
    const dependencies = { ...h.dependencies, now: () => new Date('2026-09-23T10:06:00.001Z') }
    expect(await runGuardedMarkAsSeen({ ...h.request, approval: old }, dependencies)).toEqual({
      status: 'blocked',
      reason: 'approval',
    })
  })

  it('requires trusted approval provenance', async () => {
    const h = harness()
    const dependencies = { ...h.dependencies, verifyApproval: () => Promise.resolve(false) }
    expect(await runGuardedMarkAsSeen(h.request, dependencies)).toEqual({
      status: 'blocked',
      reason: 'approval',
    })
    expect(h.provider.writes).toEqual([])
  })

  it('rejects malformed proposals and approvals before any provider call', async () => {
    const h = harness()
    const invalidTarget = {
      ...h.request.proposal,
      targets: [{ copy, threadId: '', latestMessageId: 'm-1' }],
    } as unknown as MailboxActionProposal
    expect(
      await runGuardedMarkAsSeen({ ...h.request, proposal: invalidTarget }, h.dependencies),
    ).toEqual({
      status: 'blocked',
      reason: 'invalid_scope',
    })
    const invalidApproval = { ...h.request.approval, approvedAt: 'bad date' }
    expect(
      await runGuardedMarkAsSeen({ ...h.request, approval: invalidApproval }, h.dependencies),
    ).toEqual({
      status: 'blocked',
      reason: 'approval',
    })
    expect(h.provider.capabilityCalls).toBe(0)
    expect(h.provider.readCalls).toBe(0)
    expect(h.receipts.status('attempt-1')).toBeNull()
  })

  it('blocks a new message or a changed thread before a write', async () => {
    const h = harness()
    h.provider.current = { ...h.provider.current, latestMessageId: 'm-2' }
    expect(await runGuardedMarkAsSeen(h.request, h.dependencies)).toEqual({
      status: 'blocked',
      reason: 'preflight',
    })
    h.provider.current = { ...h.provider.current, latestMessageId: 'm-1', threadId: 't-2' }
    expect(await runGuardedMarkAsSeen(h.request, h.dependencies)).toEqual({
      status: 'blocked',
      reason: 'preflight',
    })
    expect(h.provider.writes).toEqual([])
  })

  it('does not write when a new message arrives after preflight', async () => {
    const h = harness()
    h.provider.moveBeforeWrite = true
    expect(await runGuardedMarkAsSeen(h.request, h.dependencies)).toEqual({ status: 'uncertain' })
    expect(h.provider.writes).toEqual([])
    expect(h.receipts.status('attempt-1')).toBe('uncertain')
  })

  it('blocks a readback for another mailbox copy and an already seen copy', async () => {
    const h = harness()
    h.provider.current = { ...h.provider.current, copy: alias }
    expect(await runGuardedMarkAsSeen(h.request, h.dependencies)).toEqual({
      status: 'blocked',
      reason: 'invalid_scope',
    })
    h.provider.current = { ...h.provider.current, copy, unread: false }
    expect(await runGuardedMarkAsSeen(h.request, h.dependencies)).toEqual({
      status: 'blocked',
      reason: 'preflight',
    })
    expect(h.provider.writes).toEqual([])
  })

  it('blocks when the kill switch is off', async () => {
    const h = harness()
    h.disable()
    expect(await runGuardedMarkAsSeen(h.request, h.dependencies)).toEqual({
      status: 'blocked',
      reason: 'disabled',
    })
    expect(h.provider.writes).toEqual([])
  })

  it('does not retry a write whose provider outcome is uncertain', async () => {
    const h = harness()
    h.provider.failWrite = true
    expect(await runGuardedMarkAsSeen(h.request, h.dependencies)).toEqual({ status: 'uncertain' })
    expect(h.receipts.status('attempt-1')).toBe('uncertain')
    h.provider.current = { ...h.provider.current, unread: true }
    expect(await runGuardedMarkAsSeen(h.request, h.dependencies)).toEqual({
      status: 'blocked',
      reason: 'replay',
    })
    expect(h.provider.writes).toHaveLength(1)
  })

  it('holds a copy lock across newly minted proposals after uncertainty', async () => {
    const h = harness()
    h.provider.failWrite = true
    expect(await runGuardedMarkAsSeen(h.request, h.dependencies)).toEqual({ status: 'uncertain' })
    h.provider.current = { ...h.provider.current, unread: true }
    const later = proposeMailboxAction({
      ...h.request.proposal,
      proposedAt: '2026-09-23T10:00:30.000Z',
    })
    const next = {
      proposal: later,
      approval: approveProposal(later, { approvedBy: 'local reviewer', approvedAt }),
      idempotencyKey: 'attempt-2',
    }
    expect(await runGuardedMarkAsSeen(next, h.dependencies)).toEqual({
      status: 'blocked',
      reason: 'conflict',
    })
    expect(h.provider.writes).toHaveLength(1)
  })

  it('does not report success when provider post-write readback fails', async () => {
    const h = harness()
    h.provider.failReadAfterWrite = true
    expect(await runGuardedMarkAsSeen(h.request, h.dependencies)).toEqual({ status: 'uncertain' })
    expect(h.receipts.status('attempt-1')).toBe('uncertain')
    expect(h.provider.writes).toHaveLength(1)
  })

  it('does not confirm a readback of another mailbox copy', async () => {
    const h = harness()
    h.provider.wrongReadAfterWrite = true
    expect(await runGuardedMarkAsSeen(h.request, h.dependencies)).toEqual({ status: 'uncertain' })
    expect(h.receipts.status('attempt-1')).toBe('uncertain')
  })

  it('blocks replay and key conflicts before any second write', async () => {
    const h = harness()
    expect(await runGuardedMarkAsSeen(h.request, h.dependencies)).toEqual({ status: 'confirmed' })
    h.provider.current = { ...h.provider.current, unread: true }
    expect(await runGuardedMarkAsSeen(h.request, h.dependencies)).toEqual({
      status: 'blocked',
      reason: 'replay',
    })
    expect(
      await runGuardedMarkAsSeen({ ...h.request, idempotencyKey: 'attempt-2' }, h.dependencies),
    ).toEqual({ status: 'blocked', reason: 'conflict' })
    expect(h.provider.writes).toHaveLength(1)
  })
})

it('keeps a pending receipt across database reopen, preventing crash replay', () => {
  const dir = mkdtempSync(join(tmpdir(), 'spark-action-'))
  const path = join(dir, 'receipts.sqlite')
  try {
    const first = new DatabaseSync(path)
    expect(createActionReceiptStore(first).claim('key', 'proposal', copy, now)).toBe('claimed')
    first.close()
    const second = new DatabaseSync(path)
    const receipts = createActionReceiptStore(second)
    expect(receipts.claim('key', 'proposal', copy, now)).toBe('replay')
    expect(receipts.claim('key', 'different-proposal', copy, now)).toBe('conflict')
    expect(receipts.claim('another-key', 'another-proposal', copy, now)).toBe('conflict')
    expect(receipts.status('key')).toBe('pending')
    second.close()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

it('refuses an in-memory receipt database for execution', () => {
  const db = new DatabaseSync(':memory:')
  try {
    expect(() => createActionReceiptStore(db)).toThrow('receipt_storage_not_durable')
  } finally {
    db.close()
  }
})
