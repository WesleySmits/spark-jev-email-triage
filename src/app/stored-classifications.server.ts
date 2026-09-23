/**
 * What shadow triage stored about the rows a reading listed, and what one
 * freshly read thread proves about the judgment stored for its row.
 *
 * Read-only in every sense: the shadow-triage database is opened read-only,
 * no mailbox is read here, and no classifier is asked. Loading or refreshing
 * the page classifies nothing; it reads back what a `pnpm shadow --apply`
 * run judged earlier, and nothing else. `verifiedClassificationFor` adds no
 * provider call of its own: it is given the thread that the lazy body read
 * of one opened row already returned.
 *
 * Absence and unavailability stay apart. A database that was never written
 * says `none`, because nothing was stored. A database that is there but
 * cannot be read — an unsupported schema, a corrupt or unreadable file, a
 * failing query — says `unavailable`, because what it holds is unknown.
 * Neither ever hides mail: the page lists everything it listed either way.
 */
import { existsSync } from 'node:fs'
import type { DatabaseSync } from 'node:sqlite'
import { mailboxCopyId, type MailboxCopyRef } from '../domain/mailbox-copy'
import {
  projectClassification,
  verifyClassification,
  type CurrentJudge,
  type ObservedThread,
  type StoredClassification,
} from '../domain/stored-classification'
import { currentTriageRubric } from '../domain/triage'
import { jevModel } from '../jev/questions'
import { readDatabasePath } from '../shadow/config'
import { openReadOnly, ShadowDatabaseError } from '../shadow/database'
import { readJudgments } from '../shadow/judgments'
import type { InboxSummary } from './inbox'
import type { ListedClassifications } from './live-inbox'

/** The versions a stored judgment must name to still describe a row. */
const currentJudge: CurrentJudge = {
  rubric: currentTriageRubric,
  classifierVersion: jevModel,
}

const none: StoredClassification = { state: 'none' }
const unreadable: StoredClassification = { state: 'unavailable', reason: 'unreadable' }

type Env = Readonly<Record<string, string | undefined>>

type Storage =
  | Readonly<{ status: 'open'; db: DatabaseSync }>
  /** Nothing was ever stored here, so every row is genuinely unclassified. */
  | Readonly<{ status: 'absent' }>
  | Readonly<{ status: 'unavailable'; classification: StoredClassification }>

/** Opens the stored judgments read-only, or says why they cannot be read. */
function openStorage(env: Env): Storage {
  const path = readDatabasePath(env)
  if (!existsSync(path)) return { status: 'absent' }
  try {
    return { status: 'open', db: openReadOnly(path) }
  } catch (error) {
    // A schema this build does not support is still a database; anything
    // else, such as a corrupt file, is one that cannot be read at all.
    const reason = error instanceof ShadowDatabaseError ? 'unsupported_schema' : 'unreadable'
    return { status: 'unavailable', classification: { state: 'unavailable', reason } }
  }
}

/** What a closed database says about every row: nothing stored, or nothing readable. */
const closedState = (storage: Extract<Storage, { status: 'absent' | 'unavailable' }>) =>
  storage.status === 'absent' ? none : storage.classification

const sameForAll = (messages: readonly InboxSummary[], state: StoredClassification) =>
  Object.fromEntries(messages.map((message) => [message.id, state]))

/**
 * What is stored about every listed row, by the row's id. Every listed row
 * is present: one nothing applies to reads as `none`, and none of them can
 * read as `current`, because listing mail reads no thread.
 */
export function classificationsFor(
  messages: readonly InboxSummary[],
  env: Env = process.env,
): ListedClassifications {
  const storage = openStorage(env)
  if (storage.status !== 'open') return sameForAll(messages, closedState(storage))
  try {
    return { ...sameForAll(messages, none), ...stored(storage.db, messages) }
  } catch {
    return sameForAll(messages, unreadable)
  } finally {
    storage.db.close()
  }
}

/**
 * What the judgment stored for one copy says, against the thread the
 * provider has just returned for it. This is the only place a stored
 * judgment can become `current`, and it reads no provider itself.
 */
export function verifiedClassificationFor(
  observed: ObservedThread,
  env: Env = process.env,
): StoredClassification {
  const storage = openStorage(env)
  if (storage.status !== 'open') return closedState(storage)
  try {
    const judgments = readJudgments(storage.db, [observed.copy]).get(mailboxCopyId(observed.copy))
    return verifyClassification(projectClassification(judgments ?? [], currentJudge), observed)
  } catch {
    return unreadable
  } finally {
    storage.db.close()
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
