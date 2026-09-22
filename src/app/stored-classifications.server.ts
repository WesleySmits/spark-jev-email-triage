/**
 * What shadow triage stored about the rows one reading listed.
 *
 * Read-only in every sense: the shadow-triage database is opened read-only,
 * no mailbox is read, and no classifier is asked. Loading or refreshing the
 * page therefore never classifies anything; it reads back what a `pnpm
 * shadow --apply` run judged earlier, and nothing else.
 *
 * Absence never blocks a reading. A database that is not there yet, holds a
 * schema this build does not support, or cannot be read at all gives every
 * row `none`: the same state as a row nothing was stored for. The page still
 * lists all of its mail, and no error reaches it.
 */
import { existsSync } from 'node:fs'
import type { DatabaseSync } from 'node:sqlite'
import { mailboxCopyId, type MailboxCopyRef } from '../domain/mailbox-copy'
import {
  projectClassification,
  type CurrentJudge,
  type StoredClassification,
} from '../domain/stored-classification'
import { currentTriageRubric } from '../domain/triage'
import { jevModel } from '../jev/questions'
import { readDatabasePath } from '../shadow/config'
import { openReadOnly } from '../shadow/database'
import { readJudgments } from '../shadow/judgments'
import type { InboxSummary } from './inbox'
import type { ListedClassifications } from './live-inbox'

/** The versions a stored judgment must name to still describe a row. */
const currentJudge: CurrentJudge = {
  rubric: currentTriageRubric,
  classifierVersion: jevModel,
}

const none: StoredClassification = { state: 'none' }

/**
 * The stored judgment of every listed row, by the row's id. A row nothing
 * applies to is present with `none`, so a reader never has to read absence.
 */
export function classificationsFor(
  messages: readonly InboxSummary[],
  env: Readonly<Record<string, string | undefined>> = process.env,
): ListedClassifications {
  const unclassified: ListedClassifications = Object.fromEntries(
    messages.map((message) => [message.id, none]),
  )
  const path = readDatabasePath(env)
  if (!existsSync(path)) return unclassified
  let db: DatabaseSync | undefined
  try {
    db = openReadOnly(path)
    return { ...unclassified, ...stored(db, messages) }
  } catch {
    // A database that cannot be read is an absent one. Mail is not evidence
    // of a judgment, so nothing is dropped and nothing is guessed.
    return unclassified
  } finally {
    db?.close()
  }
}

/** Each row's copy, judged against the versions this build uses now. */
function stored(db: DatabaseSync, messages: readonly InboxSummary[]): ListedClassifications {
  const copies = new Map<string, MailboxCopyRef>()
  for (const { id, mailbox, messageId } of messages) {
    if (messageId !== undefined) copies.set(id, { mailboxId: mailbox, messageId })
  }
  const judgments = readJudgments(db, [...copies.values()])
  return Object.fromEntries(
    [...copies].map(([id, copy]) => [
      id,
      projectClassification(judgments.get(mailboxCopyId(copy)) ?? [], currentJudge),
    ]),
  )
}
