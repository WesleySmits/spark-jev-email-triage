import { createHash } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { requireDurableJournal } from './durable-journal'

type ClaimResult = 'claimed' | 'replay' | 'conflict'
type ReceiptStatus = 'pending' | 'confirmed' | 'uncertain'
const durableReceiptBrand = Symbol('durable-receipt-store')

const hash = (value: string): string => createHash('sha256').update(value).digest('hex')
// Spark actions address an ID without a mailbox selector. Two alias rows that
// carry the same ID must therefore share one unresolved-attempt lock.
const targetHash = (messageId: string): string => hash(messageId)

/** A separate durable journal. Never use the read-only shadow database for action receipts. */
export function createActionReceiptStore(db: DatabaseSync) {
  requireDurableJournal(db)
  db.exec(`CREATE TABLE IF NOT EXISTS mailbox_action_receipts (
    key_hash TEXT PRIMARY KEY,
    proposal_hash TEXT NOT NULL UNIQUE,
    target_hash TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending', 'confirmed', 'uncertain')),
    created_at TEXT NOT NULL,
    readback_at TEXT
  )`)
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS mailbox_action_unresolved_target
    ON mailbox_action_receipts(target_hash) WHERE status IN ('pending', 'uncertain')`)

  /** This insert commits before the provider call. Existing receipts block another attempt. */
  function claim(key: string, proposal: string, messageId: string, now: string): ClaimResult {
    const keyHash = hash(key)
    const proposalHash = hash(proposal)
    const inserted = db
      .prepare(
        `INSERT OR IGNORE INTO mailbox_action_receipts
        (key_hash, proposal_hash, target_hash, status, created_at) VALUES (?, ?, ?, 'pending', ?)`,
      )
      .run(keyHash, proposalHash, targetHash(messageId), now)
    if (inserted.changes === 1) return 'claimed'
    const existing = db
      .prepare('SELECT proposal_hash FROM mailbox_action_receipts WHERE key_hash = ?')
      .get(keyHash)
    return existing?.['proposal_hash'] === proposalHash ? 'replay' : 'conflict'
  }

  /** Records only the verified outcome and time, never synthesized provider evidence. */
  function confirm(key: string, proposal: string, readbackAt: string): void {
    const updated = db
      .prepare(
        `UPDATE mailbox_action_receipts
        SET status = 'confirmed', readback_at = ?
        WHERE key_hash = ? AND proposal_hash = ? AND status = 'pending'`,
      )
      .run(readbackAt, hash(key), hash(proposal))
    if (updated.changes !== 1) throw new Error('receipt_transition_failed')
  }

  function markUncertain(key: string, proposal: string): void {
    const updated = db
      .prepare(
        `UPDATE mailbox_action_receipts SET status = 'uncertain'
        WHERE key_hash = ? AND proposal_hash = ? AND status = 'pending'`,
      )
      .run(hash(key), hash(proposal))
    if (updated.changes !== 1) throw new Error('receipt_transition_failed')
  }

  function status(key: string): ReceiptStatus | null {
    const row = db
      .prepare('SELECT status FROM mailbox_action_receipts WHERE key_hash = ?')
      .get(hash(key))
    const value = row?.['status']
    return value === 'pending' || value === 'confirmed' || value === 'uncertain' ? value : null
  }

  return { claim, confirm, markUncertain, status, [durableReceiptBrand]: true as const }
}

export type ActionReceiptStore = ReturnType<typeof createActionReceiptStore>

/** A guard against caller-supplied or memory-only receipt substitutes. */
export function isDurableReceiptStore(value: unknown): value is ActionReceiptStore {
  return typeof value === 'object' && value !== null && durableReceiptBrand in value
}
