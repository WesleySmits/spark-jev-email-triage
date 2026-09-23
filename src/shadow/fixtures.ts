/**
 * Synthetic stored judgments for tests: the rows one `--apply` run would
 * have written, without Spark or Jev. Values are invented, not recorded, and
 * every address uses a reserved `.example` domain.
 */
import type { DatabaseSync } from 'node:sqlite'
import { currentTriageRubric } from '../domain/triage'
import type { JevClassification } from '../jev/classifier'
import { jevResponse, type ResponseOptions } from '../jev/fixtures'
import { resolveClassification } from '../jev/policy'
import { jevModel } from '../jev/questions'
import { triageResponseSchema } from '../jev/response'
import { beginRun, recordJudgment, type JudgedThread } from './store'

/** The rubric and classifier build a stored judgment names by default. */
const judge = { rubric: currentTriageRubric, requestedModel: jevModel } as const

export const defaultJudgedAt = '2026-09-20T09:00:00.000Z'

/** A confident Jev judgment of one thread, as the classifier returns one. */
export function jevJudgment(threadId: string, options: ResponseOptions = {}): JevClassification {
  const body = triageResponseSchema.parse(jevResponse(options))
  return {
    ...judge,
    threadId,
    status: 'classified',
    model: body.model,
    usage: { inputTokens: body.usage.input_tokens, outputTokens: body.usage.output_tokens },
    answers: body.answers,
  }
}

/** A Jev call that gave no usable answer. It is never a classification. */
export const jevFailure = (threadId: string): JevClassification => ({
  ...judge,
  threadId,
  status: 'provider_failure',
  failure: { code: 'timeout', detail: null, httpStatus: null },
})

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
