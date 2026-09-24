import { createHash } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import {
  approveProposal,
  proposalId,
  type ActionApproval,
  type MailboxActionProposal,
} from '../domain/mailbox-action'
import { requireDurableJournal } from './durable-journal'

const hash = (value: string) => createHash('sha256').update(value).digest('hex')

/**
 * Server-owned approval record for one exact proposal. The browser can ask
 * for approval, but cannot supply the reviewer or time that authorizes a
 * later provider attempt. Only content-free hashes and local identity land
 * in this separate durable action journal.
 */
export function createActionApprovalStore(db: DatabaseSync) {
  requireDurableJournal(db)
  db.exec(`CREATE TABLE IF NOT EXISTS mailbox_action_approvals (
    proposal_hash TEXT PRIMARY KEY,
    approved_by TEXT NOT NULL,
    approved_at TEXT NOT NULL
  )`)

  function record(
    proposal: MailboxActionProposal,
    approvedBy: string,
    approvedAt: string,
  ): ActionApproval {
    const approval = approveProposal(proposal, { approvedBy, approvedAt })
    const key = hash(proposalId(proposal))
    db.prepare(
      `INSERT OR IGNORE INTO mailbox_action_approvals
       (proposal_hash, approved_by, approved_at) VALUES (?, ?, ?)`,
    ).run(key, approval.approvedBy, approval.approvedAt)
    const existing = db
      .prepare(
        'SELECT approved_by, approved_at FROM mailbox_action_approvals WHERE proposal_hash = ?',
      )
      .get(key)
    if (
      typeof existing?.['approved_by'] !== 'string' ||
      typeof existing['approved_at'] !== 'string'
    ) {
      throw new Error('approval_readback_failed')
    }
    return approveProposal(proposal, {
      approvedBy: existing['approved_by'],
      approvedAt: existing['approved_at'],
    })
  }

  function verify(proposal: MailboxActionProposal, approval: ActionApproval): boolean {
    if (approval.proposal !== proposalId(proposal)) return false
    const existing = db
      .prepare(
        'SELECT approved_by, approved_at FROM mailbox_action_approvals WHERE proposal_hash = ?',
      )
      .get(hash(approval.proposal))
    return (
      existing?.['approved_by'] === approval.approvedBy &&
      existing['approved_at'] === approval.approvedAt
    )
  }

  return { record, verify }
}
