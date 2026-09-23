/**
 * A stored classification, as review reads it back.
 *
 * Shadow triage judges a thread snapshot and stores the judgment together
 * with the exact version it judged: the mailbox copy it covered, that
 * snapshot's latest message, the rubric, and the pinned classifier build.
 * Reading one back is a decision about that version and nothing else, so it
 * is made here, over plain data: no classifier is asked, and no mailbox or
 * provider is read.
 *
 * Evidence comes in two strengths, and the states say which one a row has:
 *
 * - The store alone can only say what it last observed. Listing mail reads
 *   no thread, so a judgment the store cannot contradict is `unverified`:
 *   its labels are shown as what was judged, never as what holds now. A
 *   message the provider delivered after the last run leaves the store
 *   untouched, so a store that says nothing is not evidence of currency.
 * - A thread the provider just returned can prove it. Only that makes a
 *   judgment `current`, and only when the freshly read thread names the same
 *   mailbox copy, thread and latest message the judgment does, under the
 *   current rubric and classifier build. See `verifyClassification`, which
 *   the lazy body read of one opened row calls with what it read; nothing
 *   reads a thread to classify or to refresh a list.
 *
 * Invariants:
 * - A judgment applies to the one mailbox copy it covered. Two copies of one
 *   delivery, e.g. to two aliases, never share a judgment; this application
 *   has no evidence they are the same communication. See `mailboxCopyId`.
 * - A judgment the store itself contradicts is `stale`: the store observed a
 *   newer message in its thread, or it names another rubric or classifier
 *   build. A later live read never promotes a stale judgment back.
 * - A provider failure never becomes a classification. It reads as its own
 *   state and carries no category or priority.
 * - Absence and unavailability are different. `none` means nothing was
 *   stored for this row; `unavailable` means what was stored could not be
 *   read. Neither hides mail or blocks a reading.
 *
 * When more than one judgment covers a copy, a classification wins over a
 * failed attempt and the newest judgment wins over an older one. So a stored
 * classification still shows while a retry for the newer version failed,
 * labelled `stale`: a provider outage neither hides what was judged nor lets
 * it pass as current.
 */
import { z } from 'zod'
import { mailboxCopyId, mailboxCopyRefSchema, type MailboxCopyRef } from './mailbox-copy'
import { categorySchema, prioritySchema } from './triage'

const id = z.string().trim().min(1)
const version = z.string().trim().min(1)

/** What a stored classification proposes. Labels only: they authorize nothing. */
const classificationLabelsSchema = z.strictObject({
  category: categorySchema,
  priority: prioritySchema,
  /** Probability of the chosen category, as the classifier reported it. */
  confidence: z.number().min(0).max(1),
  /** The classifier was unsure of the priority. Shown, never acted on. */
  priorityUncertain: z.boolean(),
  /** `auto_accepted` accepts the labels only; it permits no mailbox action. */
  review: z.enum(['auto_accepted', 'needs_review']),
  reviewPriority: z.enum(['normal', 'elevated']),
})

export type ClassificationLabels = z.infer<typeof classificationLabelsSchema>

/**
 * The exact version a stored judgment names. The store keys a judgment by
 * it, so a judged subject names exactly one classification; a human review
 * refers to a classification by naming it. See `domain/review.ts`.
 */
export const judgedSubjectSchema = z.strictObject({
  /** The mailbox copy that was read and judged. */
  copy: mailboxCopyRefSchema,
  /** Provider-local: it means nothing outside `copy.mailboxId`. */
  threadId: id,
  /** The snapshot's latest message when the classifier judged it. */
  latestMessageId: id,
  /** May name a rubric this build no longer knows; such a judgment is never current. */
  rubric: version,
  /** The pinned classifier build that was asked. */
  classifierVersion: version,
})

export type JudgedSubject = Readonly<z.infer<typeof judgedSubjectSchema>>

const verdictSchema = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('classified'), labels: classificationLabelsSchema }),
  z.strictObject({
    status: z.literal('provider_failure'),
    /** A content-free provider code, e.g. `timeout`. Never provider text. */
    errorCode: z.string().nullable(),
  }),
])

export const storedJudgmentSchema = z.strictObject({
  subject: judgedSubjectSchema,
  /** The latest message the store has observed in the judged thread so far. */
  threadLatestMessageId: id,
  judgedAt: z.iso.datetime({ offset: true }),
  verdict: verdictSchema,
})

export type StoredJudgment = z.infer<typeof storedJudgmentSchema>

/**
 * Why a stored classification no longer describes the row:
 * - `newer_message`: a later message belongs to the thread than the one judged.
 * - `other_snapshot`: the thread read for this copy is no longer the one judged.
 * - `rubric`, `classifier`: another rubric or classifier build judged it.
 */
const staleReasonSchema = z.enum(['newer_message', 'other_snapshot', 'rubric', 'classifier'])

/** What every stored judgment names, whatever became of it. */
const judged = {
  subject: judgedSubjectSchema,
  judgedAt: storedJudgmentSchema.shape.judgedAt,
}

/** What review knows about one row without asking a classifier. */
export const storedClassificationSchema = z.discriminatedUnion('state', [
  /** A thread just read proves the judgment names this row's current version. */
  z.strictObject({ ...judged, state: z.literal('current'), labels: classificationLabelsSchema }),
  /** Judged, and nothing stored contradicts it; no read has proven it either. */
  z.strictObject({ ...judged, state: z.literal('unverified'), labels: classificationLabelsSchema }),
  z.strictObject({
    ...judged,
    state: z.literal('stale'),
    reason: staleReasonSchema,
    labels: classificationLabelsSchema,
  }),
  z.strictObject({
    ...judged,
    state: z.literal('provider_failure'),
    errorCode: z.string().nullable(),
  }),
  /** Nothing stored applies to this row: it is unclassified, not failed. */
  z.strictObject({ state: z.literal('none') }),
  /** Judgments exist, or may, but could not be read. Absence is not claimed. */
  z.strictObject({
    state: z.literal('unavailable'),
    reason: z.enum(['unsupported_schema', 'unreadable']),
  }),
])

export type StoredClassification = Readonly<z.infer<typeof storedClassificationSchema>>

type StaleReason = z.infer<typeof staleReasonSchema>
type Judged = Readonly<{ subject: JudgedSubject; judgedAt: string }>

/** The versions a reading judges applicability against. */
export interface CurrentJudge {
  rubric: string
  classifierVersion: string
}

/** What one thread the provider just returned proves about the copy read. */
export interface ObservedThread {
  /** The mailbox copy that was read, as it was asked for. */
  copy: MailboxCopyRef
  /** The thread id that answer derives to now; provider-local, and it moves. */
  threadId: string
  /** The last message the provider returned for it. */
  latestMessageId: string
}

type Verdict<S extends StoredJudgment['verdict']['status']> = StoredJudgment & {
  verdict: Extract<StoredJudgment['verdict'], { status: S }>
}

const isClassified = (judgment: StoredJudgment): judgment is Verdict<'classified'> =>
  judgment.verdict.status === 'classified'

const isFailure = (judgment: StoredJudgment): judgment is Verdict<'provider_failure'> =>
  judgment.verdict.status === 'provider_failure'

/** `null` when nothing the store holds contradicts the judgment. */
function storedStaleReason(judgment: StoredJudgment, judge: CurrentJudge): StaleReason | null {
  const { subject } = judgment
  if (subject.latestMessageId !== judgment.threadLatestMessageId) return 'newer_message'
  if (subject.rubric !== judge.rubric) return 'rubric'
  return subject.classifierVersion === judge.classifierVersion ? null : 'classifier'
}

const named = ({ subject, judgedAt }: StoredJudgment): Judged => ({ subject, judgedAt })

/** Newest first. Judgments stored at the same moment keep the given order. */
const newestFirst = (judgments: readonly StoredJudgment[]) =>
  [...judgments].sort((a, b) => (a.judgedAt < b.judgedAt ? 1 : a.judgedAt > b.judgedAt ? -1 : 0))

/**
 * What the judgments that cover one mailbox copy say about it, on the
 * store's evidence alone. Pass every stored judgment of that copy.
 *
 * It never answers `current`: listing mail reads no thread, so nothing here
 * can know what the provider holds now. The strongest answer is
 * `unverified`, which `verifyClassification` can later confirm or correct.
 */
export function projectClassification(
  judgments: readonly StoredJudgment[],
  judge: CurrentJudge,
): StoredClassification {
  const stored = newestFirst(judgments)
  const classified = stored.filter(isClassified)
  const applicable = classified.find((judgment) => storedStaleReason(judgment, judge) === null)
  if (applicable !== undefined) {
    return { ...named(applicable), state: 'unverified', labels: applicable.verdict.labels }
  }
  const [stale] = classified
  const reason = stale === undefined ? null : storedStaleReason(stale, judge)
  if (stale !== undefined && reason !== null) {
    return { ...named(stale), state: 'stale', reason, labels: stale.verdict.labels }
  }
  const failed = stored
    .filter(isFailure)
    .find((judgment) => storedStaleReason(judgment, judge) === null)
  if (failed === undefined) return { state: 'none' }
  return { ...named(failed), state: 'provider_failure', errorCode: failed.verdict.errorCode }
}

/**
 * The same classification, against a thread the provider has just returned
 * for that copy. This is the only way a judgment becomes `current`, and it
 * happens on the lazy read of one opened row: no thread is read to list mail.
 *
 * Only an `unverified` classification is decided here. A judgment the store
 * already contradicts stays `stale`, a failure stays a failure, and absence
 * or unavailability stay what they are. A thread read for another copy
 * proves nothing about this one and changes nothing.
 */
export function verifyClassification(
  classification: StoredClassification,
  observed: ObservedThread,
): StoredClassification {
  if (classification.state !== 'unverified') return classification
  const { subject } = classification
  if (mailboxCopyId(subject.copy) !== mailboxCopyId(observed.copy)) return classification
  if (subject.latestMessageId !== observed.latestMessageId) {
    return { ...classification, state: 'stale', reason: 'newer_message' }
  }
  if (subject.threadId !== observed.threadId) {
    return { ...classification, state: 'stale', reason: 'other_snapshot' }
  }
  return { ...classification, state: 'current' }
}
