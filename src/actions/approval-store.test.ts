import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { proposeMailboxAction } from '../domain/mailbox-action'
import { createActionApprovalStore } from './approval-store'

const proposal = () =>
  proposeMailboxAction({
    kind: 'markAsDone',
    scope: 'spark-message-id',
    targets: [
      {
        copy: { mailboxId: 'studio@example.test', messageId: '48271' },
        threadId: '48000',
        latestMessageId: '48271',
      },
    ],
    basis: null,
    proposedAt: '2026-09-24T08:00:00.000Z',
  })

const dirs = new Set<string>()
const dbs = new Set<DatabaseSync>()

afterEach(() => {
  for (const db of dbs) db.close()
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
  dbs.clear()
  dirs.clear()
})

function open() {
  const dir = mkdtempSync(join(tmpdir(), 'spark-approval-'))
  dirs.add(dir)
  const db = new DatabaseSync(join(dir, 'actions.sqlite'))
  dbs.add(db)
  return { db, store: createActionApprovalStore(db) }
}

describe('durable action approvals', () => {
  it('uses the first server-owned reviewer and time for an exact proposal', () => {
    const { db, store } = open()
    const chosen = proposal()
    const first = store.record(chosen, 'local operator', '2026-09-24T08:01:00.000Z')
    const replay = store.record(chosen, 'other operator', '2026-09-24T08:02:00.000Z')
    expect(replay).toEqual(first)
    expect(store.verify(chosen, first)).toBe(true)
    expect(store.verify(chosen, { ...first, approvedAt: '2026-09-24T08:02:00.000Z' })).toBe(false)
    expect(db.prepare('SELECT COUNT(*) AS count FROM mailbox_action_approvals').get()).toEqual({
      count: 1,
    })
  })

  it('does not carry approval to a different action or message id', () => {
    const { store } = open()
    const chosen = proposal()
    const approval = store.record(chosen, 'local', '2026-09-24T08:01:00.000Z')
    const [target] = chosen.targets
    if (target === undefined) throw new Error('proposal needs a target')
    const other = proposeMailboxAction({
      ...chosen,
      targets: [{ ...target, copy: { ...target.copy, messageId: '48272' } }],
    })
    expect(store.verify(other, approval)).toBe(false)
  })

  it('refuses a memory database as an approval authority', () => {
    const db = new DatabaseSync(':memory:')
    dbs.add(db)
    expect(() => createActionApprovalStore(db)).toThrow('action_storage_not_durable')
  })
})
