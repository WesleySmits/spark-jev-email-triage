/**
 * Reads stored judgments back, by mailbox copy. Nothing here writes, and
 * nothing here classifies: it is the read side of `store.ts`.
 *
 * A judgment is found through the messages it covered, and each of those
 * names the mailbox it was read in, so a copy in another mailbox never picks
 * up this one's judgment. Each row is read together with the latest message
 * the store has since observed in that judgment's thread, which is what says
 * whether the judgment still describes the current version.
 *
 * Every row is checked against the domain schema. One this build cannot
 * read, such as a category its rubric no longer knows, is skipped rather
 * than guessed at; the copy then reads as unclassified.
 */
import type { DatabaseSync } from 'node:sqlite'
import { z } from 'zod'
import { mailboxCopyId, type MailboxCopyRef } from '../domain/mailbox-copy'
import { storedJudgmentSchema, type StoredJudgment } from '../domain/stored-classification'

/** Every judgment that covered one mailbox copy, newest first. */
const query = `
  SELECT j.thread_id, j.latest_message_id, j.rubric, j.requested_model, j.status,
         j.category, j.priority, j.category_confidence, j.priority_uncertain,
         j.review, j.review_priority, j.error_code, j.judged_at,
         t.latest_message_id AS thread_latest_message_id
  FROM judgment_messages m
  JOIN judgments j ON j.id = m.judgment_id
  JOIN threads t ON t.mailbox_id = j.mailbox_id AND t.thread_id = j.thread_id
  WHERE m.mailbox_id = :mailboxId AND m.message_id = :messageId
  ORDER BY j.judged_at DESC, j.id DESC`

const rowsSchema = z.array(
  z.object({
    thread_id: z.string(),
    latest_message_id: z.string(),
    rubric: z.string(),
    requested_model: z.string(),
    status: z.string(),
    category: z.string().nullable(),
    priority: z.string().nullable(),
    category_confidence: z.number().nullable(),
    priority_uncertain: z.int().nullable(),
    review: z.string(),
    review_priority: z.string(),
    error_code: z.string().nullable(),
    judged_at: z.string(),
    thread_latest_message_id: z.string(),
  }),
)

type Row = z.infer<typeof rowsSchema>[number]

/** A classification, or the failed attempt that produced none. */
const verdictOf = (row: Row) =>
  row.status === 'classified'
    ? {
        status: 'classified',
        labels: {
          category: row.category,
          priority: row.priority,
          confidence: row.category_confidence,
          priorityUncertain: row.priority_uncertain === 1,
          review: row.review,
          reviewPriority: row.review_priority,
        },
      }
    : { status: 'provider_failure', errorCode: row.error_code }

const judgmentOf = (copy: MailboxCopyRef, row: Row) =>
  storedJudgmentSchema.safeParse({
    subject: {
      copy,
      threadId: row.thread_id,
      latestMessageId: row.latest_message_id,
      rubric: row.rubric,
      classifierVersion: row.requested_model,
    },
    threadLatestMessageId: row.thread_latest_message_id,
    judgedAt: row.judged_at,
    verdict: verdictOf(row),
  })

/**
 * The stored judgments of each named copy, newest first, by copy id. A copy
 * without a readable judgment is absent, which is not an error: it has none.
 */
export function readJudgments(
  db: DatabaseSync,
  copies: readonly MailboxCopyRef[],
): ReadonlyMap<string, readonly StoredJudgment[]> {
  const statement = db.prepare(query)
  const byCopy = new Map<string, readonly StoredJudgment[]>()
  for (const copy of copies) {
    const rows = rowsSchema.parse(
      statement.all({ mailboxId: copy.mailboxId, messageId: copy.messageId }),
    )
    const judgments = rows.flatMap((row) => {
      const parsed = judgmentOf(copy, row)
      return parsed.success ? [parsed.data] : []
    })
    if (judgments.length > 0) byCopy.set(mailboxCopyId(copy), judgments)
  }
  return byCopy
}
