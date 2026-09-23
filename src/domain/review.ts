/**
 * A human review of one stored classification: a confirmation, or a
 * correction of its labels.
 *
 * A review never edits what it reviews. The classifier's judgment stays
 * exactly as it was stored, and the review is added beside it, so what a
 * classifier proposed and what a person made of it stay separately legible.
 * Reviews accumulate: a correction after a confirmation leaves the
 * confirmation in place, and both stay readable afterwards.
 *
 * Invariants:
 * - A review refers to one classification, by the subject that classifier
 *   judged. The store keys a judgment by that subject, so naming it names
 *   one classification and the exact version the reviewer was shown: the
 *   mailbox copy, the thread, its latest message then, the rubric and the
 *   pinned classifier build.
 * - A classification that is no longer current cannot be reviewed as
 *   current. A newer message in the thread, another rubric or another
 *   classifier build all move the subject on, and a review written against
 *   the version before that is refused rather than applied to the new one.
 *   See `admitReview`, which is the only gate; storage adds no rule of its
 *   own beyond writing what was admitted.
 * - A review decides labels and nothing else. Like a classification, it
 *   authorizes no mailbox action, and nothing here reads or changes a
 *   mailbox: reviewing runs no provider command at all.
 * - Only a review that names the classification a reading currently holds
 *   decides what that row shows. Reviews of earlier versions stay in
 *   history and describe the version they named, so no one's reading is
 *   deleted to make a later one win.
 */
import { z } from 'zod'
import { mailboxCopyId } from './mailbox-copy'
import {
  judgedSubjectSchema,
  type JudgedSubject,
  type StoredClassification,
} from './stored-classification'
import { categorySchema, prioritySchema } from './triage'

/** The labels a person chose. Labels only: they authorize nothing. */
const reviewedLabelsSchema = z.strictObject({
  category: categorySchema,
  priority: prioritySchema,
})

export type ReviewedLabels = Readonly<z.infer<typeof reviewedLabelsSchema>>

/**
 * What a person decided. A confirmation keeps the classifier's labels and
 * carries none of its own, so it can never be read as having proposed them.
 */
const reviewVerdictSchema = z.discriminatedUnion('decision', [
  z.strictObject({ decision: z.literal('confirmed') }),
  z.strictObject({ decision: z.literal('corrected'), labels: reviewedLabelsSchema }),
])

export const humanReviewSchema = z.strictObject({
  /** The classification reviewed, and with it the version expected to hold. */
  classification: judgedSubjectSchema,
  verdict: reviewVerdictSchema,
  /** Who reviewed, as this computer names them. Never a mailbox address. */
  reviewer: z.string().trim().min(1),
  reviewedAt: z.iso.datetime({ offset: true }),
})

export type HumanReview = Readonly<z.infer<typeof humanReviewSchema>>

/**
 * Why a review was refused:
 * - `stale_subject`: the store holds no current classification of that
 *   version. The thread moved on, or another rubric or classifier build is
 *   current, so the reviewer read a version that no longer describes the row.
 * - `unclassified`: nothing stored classifies the copy. A failed attempt is
 *   not a classification and cannot be confirmed or corrected.
 * - `other_copy`: the review and the classification name different mailbox
 *   copies. One copy's review never travels to another.
 * - `unreadable`: what the store holds could not be read, so whether the
 *   review applies is unknown. Refusing keeps that uncertainty visible.
 *
 * Every reason is a content-free code: none of them names a subject, an
 * address or a body, so one may be shown or logged as it is.
 */
export type ReviewRefusal = 'stale_subject' | 'unclassified' | 'other_copy' | 'unreadable'

export type ReviewAdmission =
  Readonly<{ status: 'admitted' }> | Readonly<{ status: 'refused'; reason: ReviewRefusal }>

const refused = (reason: ReviewRefusal): ReviewAdmission => ({ status: 'refused', reason })

/** Whether two subjects name the same version of the same mailbox copy. */
const sameSubject = (a: JudgedSubject, b: JudgedSubject) =>
  mailboxCopyId(a.copy) === mailboxCopyId(b.copy) &&
  a.threadId === b.threadId &&
  a.latestMessageId === b.latestMessageId &&
  a.rubric === b.rubric &&
  a.classifierVersion === b.classifierVersion

/**
 * Whether a review may be recorded, given what the store currently holds
 * about the copy it names. Pass the classification `projectClassification`
 * reads for that copy now, not the one the reviewer was shown: the point is
 * to find out whether the two are still the same.
 *
 * A reading may have proven the classification current, and that is admitted
 * too. Nothing weaker is: `unverified` is as strong as the store alone can
 * be, and a review is a statement about what was stored, not about what the
 * provider holds this second.
 */
export function admitReview(
  review: HumanReview,
  classification: StoredClassification,
): ReviewAdmission {
  const reviewed = review.classification
  if (classification.state === 'unavailable') return refused('unreadable')
  if (classification.state === 'none') return refused('unclassified')
  if (mailboxCopyId(reviewed.copy) !== mailboxCopyId(classification.subject.copy)) {
    return refused('other_copy')
  }
  // A failed attempt proposed no labels, so there is nothing to confirm or
  // correct, and a contradicted judgment is no longer this row's version.
  if (classification.state === 'provider_failure') return refused('unclassified')
  if (classification.state === 'stale') return refused('stale_subject')
  return sameSubject(reviewed, classification.subject)
    ? { status: 'admitted' }
    : refused('stale_subject')
}

/** The labels a row shows, and who decided them. */
export type EffectiveOutcome =
  | Readonly<{
      decidedBy: 'reviewer'
      decision: HumanReview['verdict']['decision']
      labels: ReviewedLabels
      reviewer: string
      reviewedAt: string
    }>
  | Readonly<{ decidedBy: 'classifier'; labels: ReviewedLabels }>
  /** Nothing proposed labels for this row, so nothing decides them. */
  | Readonly<{ decidedBy: 'nobody' }>

/** Newest first. Reviews recorded at the same moment keep the given order. */
const newestFirst = (reviews: readonly HumanReview[]) =>
  [...reviews].sort((a, b) =>
    a.reviewedAt < b.reviewedAt ? 1 : a.reviewedAt > b.reviewedAt ? -1 : 0,
  )

/**
 * The outcome to show for one classification, given every review stored for
 * its copy. The latest review that names this exact classification wins: a
 * correction replaces the labels, and a confirmation keeps the classifier's.
 *
 * A review of another version of the copy decides nothing here. It stays in
 * the history the store keeps, describing the version it named; it is not
 * carried onto a classification its reviewer never read.
 */
export function effectiveOutcome(
  classification: StoredClassification,
  reviews: readonly HumanReview[],
): EffectiveOutcome {
  if (!('labels' in classification)) return { decidedBy: 'nobody' }
  const { category, priority } = classification.labels
  const [latest] = newestFirst(
    reviews.filter((review) => sameSubject(review.classification, classification.subject)),
  )
  if (latest === undefined) return { decidedBy: 'classifier', labels: { category, priority } }
  const { verdict } = latest
  return {
    decidedBy: 'reviewer',
    decision: verdict.decision,
    labels: verdict.decision === 'corrected' ? verdict.labels : { category, priority },
    reviewer: latest.reviewer,
    reviewedAt: latest.reviewedAt,
  }
}
