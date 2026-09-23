/**
 * What shadow triage stored about the rows a reading listed, what a person
 * made of it, and what one freshly read thread proves about the judgment
 * stored for its row.
 *
 * A stored judgment and the reviews of it are read together, in one open of
 * the database, and projected by `effectiveOutcome` into what the row shows
 * now. So a correction a person saved is there again after a refresh and on
 * reopening the row, without anything being classified or read from a
 * provider to find out. The judgment itself is returned exactly as it was
 * stored beside it, so what the model proposed stays legible next to what a
 * person decided.
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
import { effectiveOutcome, type EffectiveOutcome } from '../domain/review'
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
import { readReviews } from '../shadow/reviews'
import type { RowReview } from './desk-review'
import type { InboxSummary } from './inbox'
import type { ListedClassifications, ListedReviews } from './live-inbox'

/** The versions a stored judgment must name to still describe a row. */
const currentJudge: CurrentJudge = {
  rubric: currentTriageRubric,
  classifierVersion: jevModel,
}

const none: StoredClassification = { state: 'none' }
const unreadable: StoredClassification = { state: 'unavailable', reason: 'unreadable' }

/**
 * What a reading holds about one row: the stored judgment, and what a person
 * decided about that exact judgment, where anyone has. The two travel
 * together, because a review only decides a row through the classification it
 * named; neither is ever shown without the other.
 */
export type StoredRow = Readonly<{
  classification: StoredClassification
  review?: RowReview | undefined
}>

/** Every listed row, and what a person decided about each, where anyone did. */
export type StoredRows = Readonly<{
  classifications: ListedClassifications
  reviews: ListedReviews
}>

/**
 * The reviewer's decision, or nothing. `classifier` and `nobody` say the row
 * shows what the classification already holds, which the caller has, so only
 * a person's decision needs saying.
 */
const decidedByPerson = (outcome: EffectiveOutcome): RowReview | undefined =>
  outcome.decidedBy === 'reviewer' ? outcome : undefined

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

/** Every row in the same state, and none of them reviewed. */
const allIn = (messages: readonly InboxSummary[], state: StoredClassification): StoredRows => ({
  classifications: sameForAll(messages, state),
  reviews: {},
})

/**
 * What is stored about every listed row, by the row's id, and what a person
 * decided about it. Every listed row has a classification: one nothing
 * applies to reads as `none`, and none of them can read as `current`, because
 * listing mail reads no thread. A row nobody reviewed carries no review,
 * which is not an error.
 */
export function storedRowsFor(
  messages: readonly InboxSummary[],
  env: Env = process.env,
): StoredRows {
  const storage = openStorage(env)
  if (storage.status !== 'open') return allIn(messages, closedState(storage))
  try {
    const rows = stored(storage.db, messages)
    return {
      classifications: { ...sameForAll(messages, none), ...classificationsIn(rows) },
      reviews: reviewsIn(rows),
    }
  } catch {
    // A store that cannot be read says so about every row, and claims no
    // review either: what a person decided is unknown, not absent.
    return allIn(messages, unreadable)
  } finally {
    storage.db.close()
  }
}

const classificationsIn = (rows: Readonly<Record<string, StoredRow>>): ListedClassifications =>
  Object.fromEntries(Object.entries(rows).map(([id, row]) => [id, row.classification]))

const reviewsIn = (rows: Readonly<Record<string, StoredRow>>): ListedReviews =>
  Object.fromEntries(
    Object.entries(rows).flatMap(([id, row]) => (row.review ? [[id, row.review]] : [])),
  )

/**
 * What the judgment stored for one copy says, against the thread the
 * provider has just returned for it, and what a person decided about it.
 * This is the only place a stored judgment can become `current`, and it reads
 * no provider itself. Reopening a row therefore shows the review again, from
 * the same open of the database that verifies the judgment.
 */
export function verifiedRowFor(observed: ObservedThread, env: Env = process.env): StoredRow {
  const storage = openStorage(env)
  if (storage.status !== 'open') return { classification: closedState(storage) }
  try {
    const { copy } = observed
    const judgments = readJudgments(storage.db, [copy]).get(mailboxCopyId(copy))
    const classification = verifyClassification(
      projectClassification(judgments ?? [], currentJudge),
      observed,
    )
    return { classification, review: reviewOf(storage.db, copy, classification) }
  } catch {
    return { classification: unreadable }
  } finally {
    storage.db.close()
  }
}

/**
 * What a person decided about one copy's classification. `effectiveOutcome`
 * keeps the scoping: only a review that names this exact subject — the same
 * mailbox copy, thread, latest message, rubric and classifier build — decides
 * this row. A review of another copy, or of a version that has moved on,
 * stays in the store describing what it named and never reaches this row.
 */
function reviewOf(db: DatabaseSync, copy: MailboxCopyRef, classification: StoredClassification) {
  const reviews = readReviews(db, [copy]).get(mailboxCopyId(copy)) ?? []
  return decidedByPerson(effectiveOutcome(classification, reviews))
}

/** Each row's copy, judged against the versions this build uses now. */
function stored(
  db: DatabaseSync,
  messages: readonly InboxSummary[],
): Readonly<Record<string, StoredRow>> {
  const copies = new Map<string, MailboxCopyRef>()
  for (const { id, mailbox, messageId } of messages) {
    if (messageId !== undefined) copies.set(id, { mailboxId: mailbox, messageId })
  }
  const judgments = readJudgments(db, [...copies.values()])
  const reviews = readReviews(db, [...copies.values()])
  return Object.fromEntries(
    [...copies].map(([id, copy]) => {
      const copyId = mailboxCopyId(copy)
      const classification = projectClassification(judgments.get(copyId) ?? [], currentJudge)
      const outcome = effectiveOutcome(classification, reviews.get(copyId) ?? [])
      return [id, { classification, review: decidedByPerson(outcome) }]
    }),
  )
}
