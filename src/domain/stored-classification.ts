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
 * Invariants:
 * - A judgment applies to the one mailbox copy it covered. Two copies of one
 *   delivery, e.g. to two aliases, never share a judgment; this application
 *   has no evidence they are the same communication. See `mailboxCopyId`.
 * - A judgment is current only while it names the current version: the
 *   latest message the store has observed in its thread, the current rubric,
 *   and the current classifier build. Anything else is stale.
 * - A provider failure never becomes a classification. It reads as its own
 *   state and carries no category or priority.
 * - Absence is a state, not an error. A row with nothing stored reads as
 *   `none`, which hides no mail and blocks no reading.
 *
 * When more than one judgment covers a copy, a classification wins over a
 * failed attempt and the newest judgment wins over an older one. So a stale
 * classification is still reported while a retry for the newer version
 * failed, labelled `stale`: a provider outage neither hides what was judged
 * nor lets it pass as current.
 */
import { z } from 'zod'
import { mailboxCopyRefSchema } from './mailbox-copy'
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

/** The exact version a stored judgment names. */
const judgedSubjectSchema = z.strictObject({
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

type JudgedSubject = z.infer<typeof judgedSubjectSchema>

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
  /** The latest message the store has since observed in the judged thread. */
  threadLatestMessageId: id,
  judgedAt: z.iso.datetime({ offset: true }),
  verdict: verdictSchema,
})

export type StoredJudgment = z.infer<typeof storedJudgmentSchema>

/** Why a stored classification no longer describes the row in front of the reader. */
export type StaleReason = 'newer_message' | 'rubric' | 'classifier'

type Judged = Readonly<{ subject: JudgedSubject; judgedAt: string }>

/** What review knows about one row without asking a classifier. */
export type StoredClassification =
  | (Judged & Readonly<{ state: 'current'; labels: ClassificationLabels }>)
  | (Judged & Readonly<{ state: 'stale'; reason: StaleReason; labels: ClassificationLabels }>)
  | (Judged & Readonly<{ state: 'provider_failure'; errorCode: string | null }>)
  /** Nothing stored applies to this row: it is unclassified, not failed. */
  | Readonly<{ state: 'none' }>

/** The versions a reading judges applicability against. */
export interface CurrentJudge {
  rubric: string
  classifierVersion: string
}

type Verdict<S extends StoredJudgment['verdict']['status']> = StoredJudgment & {
  verdict: Extract<StoredJudgment['verdict'], { status: S }>
}

const isClassified = (judgment: StoredJudgment): judgment is Verdict<'classified'> =>
  judgment.verdict.status === 'classified'

const isFailure = (judgment: StoredJudgment): judgment is Verdict<'provider_failure'> =>
  judgment.verdict.status === 'provider_failure'

/** `null` when the judgment still names the version in front of the reader. */
function staleReason(judgment: StoredJudgment, judge: CurrentJudge): StaleReason | null {
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
 * What the judgments that cover one mailbox copy say about it now. Pass
 * every stored judgment of that copy; this decides which of them, if any,
 * still applies.
 */
export function projectClassification(
  judgments: readonly StoredJudgment[],
  judge: CurrentJudge,
): StoredClassification {
  const stored = newestFirst(judgments)
  const classified = stored.filter(isClassified)
  const current = classified.find((judgment) => staleReason(judgment, judge) === null)
  if (current !== undefined) {
    return { ...named(current), state: 'current', labels: current.verdict.labels }
  }
  const [stale] = classified
  const reason = stale === undefined ? null : staleReason(stale, judge)
  if (stale !== undefined && reason !== null) {
    return { ...named(stale), state: 'stale', reason, labels: stale.verdict.labels }
  }
  const failed = stored.filter(isFailure).find((judgment) => staleReason(judgment, judge) === null)
  if (failed === undefined) return { state: 'none' }
  return { ...named(failed), state: 'provider_failure', errorCode: failed.verdict.errorCode }
}
