/**
 * Reading stored rows by the mailbox copy they belong to.
 *
 * Judgments and reviews are both looked up that way, and both must answer
 * the same shape of question: what does this database hold for each of these
 * copies, newest first, and nothing for a copy it holds nothing for. Doing
 * that once keeps the two readers from drifting apart on the part that has
 * to match, and leaves each of them its own query and its own idea of what
 * a readable row is.
 */
import type { DatabaseSync } from 'node:sqlite'
import { mailboxCopyId, type MailboxCopyRef } from '../domain/mailbox-copy'

/** Any schema that validates the rows one query returns. */
interface RowsSchema<Row> {
  parse: (rows: unknown) => Row[]
}

/**
 * What `sql` returns for each named copy, by copy id. The query is run once
 * per copy with `:mailboxId` and `:messageId` bound to it, so one mailbox's
 * rows never answer for another's. `read` turns one row into what the caller
 * wants, or into nothing when this build cannot read it: such a row is
 * skipped rather than guessed at, and stays in the database. A copy left
 * with no row is absent from the map, which is not an error.
 */
export function readByCopy<Row, Parsed>(
  db: DatabaseSync,
  sql: string,
  rows: RowsSchema<Row>,
  copies: readonly MailboxCopyRef[],
  read: (copy: MailboxCopyRef, row: Row) => readonly Parsed[],
): ReadonlyMap<string, readonly Parsed[]> {
  const statement = db.prepare(sql)
  const byCopy = new Map<string, readonly Parsed[]>()
  for (const copy of copies) {
    const found = rows
      .parse(statement.all({ mailboxId: copy.mailboxId, messageId: copy.messageId }))
      .flatMap((row) => read(copy, row))
    if (found.length > 0) byCopy.set(mailboxCopyId(copy), found)
  }
  return byCopy
}
