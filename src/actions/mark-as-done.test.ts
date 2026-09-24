import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { approveProposal, proposeMailboxAction } from '../domain/mailbox-action'
import { createActionApprovalStore } from './approval-store'
import { runGuardedMarkAsDone, type SparkDoneProviderPort } from './mark-as-done'
import { createActionReceiptStore } from './receipt-store'

const target = {
  copy: { mailboxId: 'studio@mail.example', messageId: '101' },
  threadId: '201',
  latestMessageId: '101',
}
const proposedAt = '2026-09-23T10:00:00.000Z'
const approvedAt = '2026-09-23T10:01:00.000Z'
const now = '2026-09-23T10:02:00.000Z'
const proposal = () =>
  proposeMailboxAction({
    kind: 'markAsDone',
    scope: 'spark-message-id',
    targets: [target],
    basis: null,
    proposedAt,
  })
const databases: DatabaseSync[] = []
const directories: string[] = []
afterEach(() => {
  for (const db of databases) db.close()
  for (const dir of directories) rmSync(dir, { recursive: true, force: true })
  databases.length = 0
  directories.length = 0
})

function harness() {
  const dir = mkdtempSync(join(tmpdir(), 'spark-done-'))
  directories.push(dir)
  const db = new DatabaseSync(join(dir, 'actions.sqlite'))
  databases.push(db)
  const receipts = createActionReceiptStore(db)
  const approvals = createActionApprovalStore(db)
  const proposed = proposal()
  const approval = approvals.record(proposed, 'local reviewer', approvedAt)
  const writes: string[] = []
  let preflight: 'ready' | 'refused' = 'ready'
  let readback: 'confirmed' | 'uncertain' = 'confirmed'
  let enabled = true
  let failWrite = false
  const provider: SparkDoneProviderPort = {
    preflight: () => Promise.resolve(preflight),
    markAsDone: (id) => {
      writes.push(id)
      return failWrite ? Promise.reject(new Error('private output')) : Promise.resolve()
    },
    readback: () => Promise.resolve(readback),
  }
  const dependencies = {
    provider,
    receipts,
    verifyApproval: (p: typeof proposed, a: typeof approval) =>
      Promise.resolve(approvals.verify(p, a)),
    enabled: () => enabled,
    now: () => new Date(now),
  }
  const request = { proposal: proposed, approval, idempotencyKey: 'attempt-1' }
  return {
    db,
    receipts,
    writes,
    dependencies,
    request,
    refusePreflight: () => {
      preflight = 'refused'
    },
    uncertainReadback: () => {
      readback = 'uncertain'
    },
    disable: () => {
      enabled = false
    },
    enable: () => {
      enabled = true
    },
    failWrite: () => {
      failWrite = true
    },
  }
}

describe('guarded Spark Done', () => {
  it('uses one ID-only write and confirms only after readback', async () => {
    const h = harness()
    expect(await runGuardedMarkAsDone(h.request, h.dependencies)).toEqual({ status: 'confirmed' })
    expect(h.writes).toEqual(['101'])
    expect(h.receipts.status('attempt-1')).toBe('confirmed')
    expect(
      h.db.prepare('SELECT readback_at FROM mailbox_action_receipts').get()?.['readback_at'],
    ).toBe(now)
  })

  it('stops before the write when disabled, unapproved, or preflight refuses', async () => {
    const h = harness()
    h.disable()
    expect(await runGuardedMarkAsDone(h.request, h.dependencies)).toEqual({
      status: 'blocked',
      reason: 'disabled',
    })
    h.enable()
    const other = approveProposal(h.request.proposal, { approvedBy: 'other', approvedAt })
    expect(await runGuardedMarkAsDone({ ...h.request, approval: other }, h.dependencies)).toEqual({
      status: 'blocked',
      reason: 'approval',
    })
    h.refusePreflight()
    expect(await runGuardedMarkAsDone(h.request, h.dependencies)).toEqual({
      status: 'blocked',
      reason: 'preflight',
    })
    expect(h.writes).toEqual([])
  })

  it('does not retry an uncertain or replayed action, including an alias copy', async () => {
    const h = harness()
    h.uncertainReadback()
    expect(await runGuardedMarkAsDone(h.request, h.dependencies)).toEqual({ status: 'uncertain' })
    expect(h.receipts.status('attempt-1')).toBe('uncertain')
    expect(await runGuardedMarkAsDone(h.request, h.dependencies)).toEqual({
      status: 'blocked',
      reason: 'replay',
    })
    const alias = proposeMailboxAction({
      kind: 'markAsDone',
      scope: 'spark-message-id',
      proposedAt,
      basis: null,
      targets: [{ ...target, copy: { mailboxId: 'alias@mail.example', messageId: '101' } }],
    })
    const aliasRequest = {
      proposal: alias,
      approval: approveProposal(alias, { approvedBy: 'local reviewer', approvedAt }),
      idempotencyKey: 'attempt-2',
    }
    expect(
      await runGuardedMarkAsDone(aliasRequest, {
        ...h.dependencies,
        verifyApproval: () => Promise.resolve(true),
      }),
    ).toEqual({ status: 'blocked', reason: 'conflict' })
    expect(h.writes).toEqual(['101'])
  })

  it('keeps a terminal guard when the provider call may have committed before failing', async () => {
    const h = harness()
    h.failWrite()
    h.uncertainReadback()
    expect(await runGuardedMarkAsDone(h.request, h.dependencies)).toEqual({ status: 'uncertain' })
    expect(h.receipts.status('attempt-1')).toBe('uncertain')
    expect(h.writes).toEqual(['101'])
  })

  it('confirms observed Done state after a provider timeout without a retry', async () => {
    const h = harness()
    h.failWrite()
    expect(await runGuardedMarkAsDone(h.request, h.dependencies)).toEqual({ status: 'confirmed' })
    expect(h.writes).toEqual(['101'])
  })

  it('rejects multi-target and nonnumeric identifiers', async () => {
    const h = harness()
    const multi = proposeMailboxAction({
      kind: 'markAsDone',
      scope: 'spark-message-id',
      proposedAt,
      basis: null,
      targets: [target, { ...target, copy: { mailboxId: 'alias@mail.example', messageId: '101' } }],
    })
    expect(
      await runGuardedMarkAsDone(
        {
          ...h.request,
          proposal: multi,
          approval: approveProposal(multi, { approvedBy: 'local reviewer', approvedAt }),
        },
        h.dependencies,
      ),
    ).toEqual({ status: 'blocked', reason: 'invalid_scope' })
    const invalid = proposeMailboxAction({
      kind: 'markAsDone',
      scope: 'spark-message-id',
      proposedAt,
      basis: null,
      targets: [{ ...target, copy: { ...target.copy, messageId: 'not-a-cli-id' } }],
    })
    expect(
      await runGuardedMarkAsDone(
        {
          ...h.request,
          proposal: invalid,
          approval: approveProposal(invalid, { approvedBy: 'local reviewer', approvedAt }),
        },
        h.dependencies,
      ),
    ).toEqual({ status: 'blocked', reason: 'invalid_scope' })
    expect(h.writes).toEqual([])
  })
})
