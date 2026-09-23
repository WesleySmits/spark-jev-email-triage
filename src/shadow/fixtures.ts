/**
 * Synthetic stored judgments for tests: the rows one `--apply` run would
 * have written, without Spark or Jev. Values are invented, not recorded, and
 * every address uses a reserved `.example` domain.
 */
import type { DatabaseSync } from 'node:sqlite'
import { currentTriageRubric } from '../domain/triage'
import type { JevClassification } from '../jev/classifier'
import { jevFailure, jevJudgment } from '../jev/fixtures'
import { resolveClassification } from '../jev/policy'
import { jevModel } from '../jev/questions'
import { beginRun, recordJudgment, type JudgedThread } from './store'

/** The judgments a run stores are the classifier's own; see `jev/fixtures`. */
export { jevFailure, jevJudgment }

export const defaultJudgedAt = '2026-09-20T09:00:00.000Z'

export interface StoredEntry {
  mailboxId: string
  /** The messages the judged thread held, in provider order; the last is its latest. */
  messageIds: readonly string[]
  classification: JevClassification
  judgedAt?: string
}

const judgedThread = (classification: JevClassification, entry: StoredEntry): JudgedThread => ({
  id: classification.threadId,
  latestMessageId: entry.messageIds.at(-1) ?? classification.threadId,
  messageIds: entry.messageIds,
  subject: 'Shared subject',
  senderAddress: 'sam@mail.example',
  senderName: 'Sam',
})

/** Stores each entry in `db` the way one shadow run does, under one run. */
export function storeJudgments(db: DatabaseSync, entries: readonly StoredEntry[]): void {
  const claim = beginRun(
    db,
    {
      mailboxId: entries[0]?.mailboxId ?? 'run@mail.example',
      rubric: currentTriageRubric,
      model: jevModel,
      startedAt: defaultJudgedAt,
      pid: process.pid,
    },
    () => false,
  )
  if (claim.runId === null) throw new Error('Expected a run to claim')
  for (const entry of entries) {
    const { classification, judgedAt = defaultJudgedAt } = entry
    recordJudgment(db, {
      runId: claim.runId,
      mailboxId: entry.mailboxId,
      thread: judgedThread(classification, entry),
      classification,
      outcome: resolveClassification(classification),
      judgedAt,
    })
  }
}
