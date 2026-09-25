/**
 * A human review of one stored classification: the fields of it a person
 * confirmed, and the fields they corrected.
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
 * - A review decides a field or it says nothing about it. Each field carries
 *   its own decision, and a field no review named is nobody's: it keeps
 *   showing the classifier's label, attributed to the classifier. No field is
 *   carried along to fill out a shape, because a label in a person's review
 *   reads as their decision.
 * - A review happens at one instant, and the store keeps it as one. Two
 *   reviews written in different offsets order by when they happened, not
 *   by how their timestamps read: `2026-09-21T12:00:00+02:00` came before
 *   `2026-09-21T11:00:00Z`, however the two sort as text. Every time here
 *   is normalized to UTC as it is parsed, and compared as an instant.
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

/**
 * A complete pair of labels: what holds for a row, whoever decided each one.
 * A classification proposes both; a review may decide either, both or
 * neither of them. Labels authorize nothing.
 */
export type ReviewedLabels = Readonly<{
  category: z.infer<typeof categorySchema>
  priority: z.infer<typeof prioritySchema>
}>

/**
 * What a person decided about one field. A confirmation keeps the
 * classifier's label and carries no value of its own, so it can never be
 * read as having proposed one; a correction carries the value chosen.
 */
const decisionOf = <Value extends z.ZodType>(value: Value) =>
  z.discriminatedUnion('decision', [
    z.strictObject({ decision: z.literal('confirmed') }),
    z.strictObject({ decision: z.literal('corrected'), value }),
  ])

/**
 * Which fields of one classification a person decided, and how.
 *
 * Category and priority are separate decisions, and a field left out is one
 * this review says nothing about. Only these two are reviewable: reply
 * expectation and a deadline are work decisions about what a person will do
 * next, owned where that work is decided, and a strict shape keeps them from
 * arriving here as if the classifier had proposed them for confirmation.
 *
 * A review decides at least one field. A verdict that decides none records
 * nothing, and storing it would leave a reviewer and a time standing for a
 * decision nobody made.
 */
export const reviewVerdictSchema = z
  .strictObject({
    category: decisionOf(categorySchema).optional(),
    priority: decisionOf(prioritySchema).optional(),
  })
  .refine((verdict) => verdict.category !== undefined || verdict.priority !== undefined, {
    message: 'A review decides at least one field',
  })

export type ReviewVerdict = Readonly<z.infer<typeof reviewVerdictSchema>>

/**
 * One instant, written the same way every time. The same moment can be
 * written in any offset, and those spellings do not sort as they happened,
 * so a time is normalized here instead of being compared as it was given.
 */
export const utcInstant = (value: string) => new Date(value).toISOString()

export const humanReviewSchema = z.strictObject({
  /** The classification reviewed, and with it the version expected to hold. */
  classification: judgedSubjectSchema,
  verdict: reviewVerdictSchema,
  /** Who reviewed, as this computer names them. Never a mailbox address. */
  reviewer: z.string().trim().min(1),
  /** Accepted in any offset, kept in UTC, so stored reviews compare as written. */
  reviewedAt: z.iso.datetime({ offset: true }).transform(utcInstant),
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
 * - `request_conflict`: the same Save id was used with different content.
 *
 * Every reason is a content-free code: none of them names a subject, an
 * address or a body, so one may be shown or logged as it is.
 */
export type ReviewRefusal =
  'stale_subject' | 'unclassified' | 'other_copy' | 'unreadable' | 'request_conflict'

export type ReviewAdmission =
  Readonly<{ status: 'admitted' }> | Readonly<{ status: 'refused'; reason: ReviewRefusal }>

const refused = (reason: ReviewRefusal): ReviewAdmission => ({ status: 'refused', reason })

/** Whether two subjects name the same version of the same mailbox copy. */
export const sameSubject = (a: JudgedSubject, b: JudgedSubject) =>
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
 *
 * Which fields a verdict decides makes no difference here. Staleness is
 * about the version reviewed, and a person who corrected one field of an
 * outdated judgment read the outdated one just as squarely.
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

/** Who decided one field, how, and when. */
export type FieldDecision = Readonly<{
  decision: 'confirmed' | 'corrected'
  /** How this computer named the reviewer who decided this field. */
  reviewer: string
  /** When they decided it, in UTC. */
  reviewedAt: string
}>

/**
 * The value each field a person decided now holds: the value a correction
 * chose, or the classifier's own label where they confirmed it. A field
 * nobody decided is absent, so reading one of these values is always reading
 * a person's decision and never a label carried along beside it.
 */
export type DecidedLabels = Readonly<{
  category?: ReviewedLabels['category'] | undefined
  priority?: ReviewedLabels['priority'] | undefined
}>

/** Who decided each of those fields, how, and when. The same fields as `labels`. */
export type DecidedFields = Readonly<{
  category?: FieldDecision | undefined
  priority?: FieldDecision | undefined
}>

/**
 * What a person decided about one classification, field by field.
 *
 * `decision` is the one word for the whole review — `corrected` where any
 * decided field was corrected — and `reviewer` and `reviewedAt` name the
 * newest of those field decisions. They are a summary for copy that speaks
 * of the review as a whole; `fields` is what says who decided what.
 */
export type ReviewerOutcome = Readonly<{
  decidedBy: 'reviewer'
  decision: FieldDecision['decision']
  labels: DecidedLabels
  fields: DecidedFields
  reviewer: string
  reviewedAt: string
}>

/**
 * The labels a row shows, and where they came from. `decidedBy` names the
 * source of this projection, not certification of every field: a reviewer
 * outcome holds only the fields that person decided, and every other label
 * is still the classifier's. Model uncertainty and other signals remain on
 * the original classification and must not be discarded merely because a
 * review supplies one of these labels.
 */
export type EffectiveOutcome =
  | ReviewerOutcome
  | Readonly<{ decidedBy: 'classifier'; labels: ReviewedLabels }>
  /** Nothing proposed labels for this row, so nothing decides them. */
  | Readonly<{ decidedBy: 'nobody' }>

/** One person's decisions about one classification, as the fold reads them. */
export type ReviewDecisions = Readonly<{
  verdict: ReviewVerdict
  reviewer: string
  reviewedAt: string
}>

type Decided<Value> = Readonly<{ value: Value; decision: FieldDecision }>

/**
 * The newest decision about one field, from sources given newest first, with
 * the value it settled on: the corrected value, or `confirmed`, the label the
 * reviewer confirmed. Nothing where no source decided that field.
 */
function newestDecision<Value>(
  sources: readonly ReviewDecisions[],
  decisionIn: (
    verdict: ReviewVerdict,
  ) => Readonly<{ decision: 'confirmed' } | { decision: 'corrected'; value: Value }> | undefined,
  confirmed: Value,
): Decided<Value> | undefined {
  for (const source of sources) {
    const decision = decisionIn(source.verdict)
    if (decision === undefined) continue
    return {
      value: decision.decision === 'corrected' ? decision.value : confirmed,
      decision: {
        decision: decision.decision,
        reviewer: source.reviewer,
        reviewedAt: source.reviewedAt,
      },
    }
  }
  return undefined
}

/**
 * What a set of reviews of one classification decided between them, field by
 * field, given the labels that classification proposed. Pass the reviews
 * newest first.
 *
 * Every field is decided on its own: the newest review that named a field
 * decides it, and one that named another field leaves it alone. So a person
 * who corrects the priority of a row whose category was confirmed last week
 * leaves that confirmation standing, and neither decision is read as having
 * covered the other. Nothing where no review decided any field.
 */
function foldDecisions(
  newestFirst: readonly ReviewDecisions[],
  labels: ReviewedLabels,
): ReviewerOutcome | undefined {
  const category = newestDecision(newestFirst, (verdict) => verdict.category, labels.category)
  const priority = newestDecision(newestFirst, (verdict) => verdict.priority, labels.priority)
  const decisions = [category?.decision, priority?.decision].flatMap((decision) =>
    decision === undefined ? [] : [decision],
  )
  const newest = decisions.reduce<FieldDecision | undefined>(
    (latest, decision) =>
      latest === undefined || Date.parse(decision.reviewedAt) > Date.parse(latest.reviewedAt)
        ? decision
        : latest,
    undefined,
  )
  if (newest === undefined) return undefined
  return {
    decidedBy: 'reviewer',
    decision: decisions.some(({ decision }) => decision === 'corrected')
      ? 'corrected'
      : 'confirmed',
    labels: {
      ...(category !== undefined && { category: category.value }),
      ...(priority !== undefined && { priority: priority.value }),
    },
    fields: {
      ...(category !== undefined && { category: category.decision }),
      ...(priority !== undefined && { priority: priority.decision }),
    },
    reviewer: newest.reviewer,
    reviewedAt: newest.reviewedAt,
  }
}

/**
 * One stored review as the outcome it settled, given the labels the
 * classification it named proposed. Used to answer a Save with what was
 * recorded for it, so a replay reads back the same decisions, reviewer and
 * time. Nothing where the review decided no field at all.
 */
export const reviewOutcome = (
  review: ReviewDecisions,
  labels: ReviewedLabels,
): ReviewerOutcome | undefined => foldDecisions([review], labels)

/**
 * Newest first, by the instant each review names rather than by how that
 * instant was written. Reviews of one moment keep the given order.
 */
const newestFirst = (reviews: readonly HumanReview[]) =>
  [...reviews].sort((a, b) => Date.parse(b.reviewedAt) - Date.parse(a.reviewedAt))

const decisionsOf = ({ verdict, reviewer, reviewedAt }: HumanReview): ReviewDecisions => ({
  verdict,
  reviewer,
  reviewedAt,
})

/**
 * The outcome to show for one classification, given every review stored for
 * its copy. Only the reviews that name this exact classification count, and
 * among those each field is decided by the newest one that named it: a
 * correction replaces that field's label, and a confirmation keeps the
 * classifier's. Fields nobody decided stay the classifier's, which is what
 * `decidedBy: 'classifier'` says when nobody decided any of them.
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
  const labels: ReviewedLabels = { category, priority }
  const mine = newestFirst(
    reviews.filter((review) => sameSubject(review.classification, classification.subject)),
  )
  return foldDecisions(mine.map(decisionsOf), labels) ?? { decidedBy: 'classifier', labels }
}
