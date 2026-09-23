/**
 * How the workbench asks a person to confirm or correct one classification,
 * and what it says while that is happening.
 *
 * Plain functions of plain data, like `classification.ts` beside it. Nothing
 * here reads a store, calls a classifier or touches a mailbox, and nothing
 * here saves: it decides which rows may be reviewed at all, which verdict a
 * choice amounts to, and the words for every state a save passes through.
 *
 * Two things the copy must never do, and the reason this module owns it:
 *
 * - It says a review was saved. It never says a message was completed,
 *   archived or handled, because saving a review changes no mail. Every
 *   state that mentions the mailbox says it is unchanged.
 * - It carries no subject, address or body. A refusal and a failure name a
 *   state and nothing about the message, so the same words may be announced,
 *   shown and logged.
 */
import type { DeskReviewRequest, RowReview } from '../../../app/desk-review'
import { mailboxCopyId } from '../../../domain/mailbox-copy'
import type { ReviewRefusal } from '../../../domain/review'
import type {
  ClassificationLabels,
  JudgedSubject,
  StoredClassification,
} from '../../../domain/stored-classification'
import type { ReviewCategory } from '../../organisms/ReviewPanel/ReviewPanel'
import { categoryLabels } from './classification'

export type ReviewCategoryValue = ClassificationLabels['category']

/** The category radiogroup: every category of the rubric, as it reads. */
export const reviewCategories: readonly ReviewCategory<ReviewCategoryValue>[] = Object.entries(
  categoryLabels,
).map(([value, label]) => ({ value: value as ReviewCategoryValue, label }))

/** One classification a person may review, and the version it names. */
export type Reviewable = Readonly<{ subject: JudgedSubject; labels: ClassificationLabels }>

/**
 * What of one row may be reviewed, or nothing at all.
 *
 * Only a classification that still describes the row can be confirmed or
 * corrected: one a reading proved `current`, or one the store alone holds
 * and contradicts in no way. Everything else offers no review, so nobody is
 * asked to decide on a version that has already moved on: an outdated
 * judgment, a failed attempt that proposed no labels, a row nothing
 * classified, and a store that could not be read all show no panel. The
 * store refuses those writes as well; this only keeps a person from being
 * invited to make one.
 */
export function reviewableIn(
  classification: StoredClassification | undefined,
): Reviewable | undefined {
  if (classification === undefined) return undefined
  if (classification.state !== 'current' && classification.state !== 'unverified') return undefined
  return { subject: classification.subject, labels: classification.labels }
}

/**
 * What the chosen category amounts to. Choosing what the classifier chose is
 * a confirmation, and carries no labels of its own, so it can never read as
 * having proposed them. Any other choice is a correction of the category;
 * the priority stays the one that was judged, because this panel asks about
 * the category and a person decides nothing they were not shown.
 */
export function verdictFor(
  chosen: ReviewCategoryValue,
  labels: ClassificationLabels,
): DeskReviewRequest['verdict'] {
  return chosen === labels.category
    ? { decision: 'confirmed' }
    : { decision: 'corrected', labels: { category: chosen, priority: labels.priority } }
}

/** The exact version a subject names, as one comparable value. */
const subjectId = (subject: JudgedSubject) =>
  JSON.stringify([
    mailboxCopyId(subject.copy),
    subject.threadId,
    subject.latestMessageId,
    subject.rubric,
    subject.classifierVersion,
  ])

/**
 * What the panel is asking about, as one comparable value: the version being
 * reviewed, the labels a choice is judged against, and the review already
 * stored for it.
 *
 * A reading may hand the page another version of the same open row, or a
 * review stored since it listed one, without the row closing. A choice was
 * made about what was shown at the time, so when this changes the panel has
 * to start again from what the store now says: otherwise a later save would
 * pair a choice made about the version before with the version now named.
 * The model's own labels are in it because they decide what a choice means —
 * the same category is a confirmation against one judgment and a correction
 * against another.
 *
 * The reading's id is deliberately not: it is new on every refresh, even when
 * nothing about the row changed, and starting again then would throw away a
 * review the person had just saved for no reason at all.
 */
export const reviewSignature = (reviewable: Reviewable, saved: RowReview | undefined) =>
  JSON.stringify([
    subjectId(reviewable.subject),
    reviewable.labels.category,
    reviewable.labels.priority,
    saved?.decision ?? null,
    saved?.labels.category ?? null,
    saved?.labels.priority ?? null,
    saved?.reviewedAt ?? null,
  ])

/** The request for one review of `reviewable`, naming the version shown. */
export const reviewRequest = (
  reviewable: Reviewable,
  chosen: ReviewCategoryValue,
): DeskReviewRequest => ({
  classification: reviewable.subject,
  verdict: verdictFor(chosen, reviewable.labels),
})

/**
 * Where one save has got to:
 * - `choosing`: nothing is chosen yet, so there is nothing to save.
 * - `unsaved`: a category is chosen and not yet saved.
 * - `saving`: the request is on its way.
 * - `saved`: it was recorded, as a confirmation or a correction.
 * - `refused`: the store would not take it, and said why.
 * - `failed`: nothing was stored and it was not a refusal.
 */
export type ReviewState =
  | Readonly<{ status: 'choosing' }>
  | Readonly<{ status: 'unsaved' }>
  | Readonly<{ status: 'saving' }>
  | Readonly<{ status: 'saved'; decision: 'confirmed' | 'corrected'; chosen: ReviewCategoryValue }>
  | Readonly<{ status: 'refused'; reason: ReviewRefusal }>
  | Readonly<{ status: 'failed' }>

/** Result copy beside the save button: a line, and a second one under it. */
export type ReviewResult = Readonly<{ title: string; detail: string }>

const unchanged = 'Your mailbox is unchanged.'

const waiting = {
  choosing: {
    title: 'Choose a category first',
    detail: `Pick the category this message belongs to, then save. ${unchanged}`,
  },
  unsaved: {
    title: 'Not saved yet',
    detail: `Saving records your review on this computer. ${unchanged}`,
  },
  saving: { title: 'Saving review…', detail: `Nothing is being sent to your mail. ${unchanged}` },
} as const satisfies Record<'choosing' | 'unsaved' | 'saving', ReviewResult>

/**
 * Why a refusal stored nothing, in words. Each one says what the person can
 * do next and names no message. `stale_subject` is the one a person meets:
 * a run observed a newer message, or another rubric or classifier build is
 * current, between the page listing the row and the save arriving.
 */
const refusals = {
  stale_subject: {
    title: 'Not saved',
    detail:
      'This triage is no longer the current one, so the review was refused. Refresh and open the message again to review what holds now.',
  },
  unclassified: {
    title: 'Not saved',
    detail: 'There is no current triage for this message to confirm or correct.',
  },
  other_copy: {
    title: 'Not saved',
    detail: 'The review named another copy of this message, so nothing was recorded.',
  },
  unreadable: {
    title: 'Not saved',
    detail: 'What is stored could not be read, so nothing was recorded. Try again.',
  },
} as const satisfies Record<ReviewRefusal, ReviewResult>

const failure: ReviewResult = {
  title: 'Not saved',
  detail: `The review could not be stored, so nothing was recorded. ${unchanged} Try again.`,
}

/** What a recorded review says it did, without ever saying the mail moved. */
function recorded(
  state: Extract<ReviewState, { status: 'saved' }>,
  original: string,
): ReviewResult {
  const chosen = categoryLabels[state.chosen]
  return {
    title: 'Review saved',
    detail:
      state.decision === 'confirmed'
        ? `You confirmed ${chosen}. ${unchanged}`
        : `Category set to ${chosen}. The original stays ${original}. ${unchanged}`,
  }
}

/** The result copy for one state. `original` is the classifier's category. */
export function reviewResult(state: ReviewState, original: string): ReviewResult {
  switch (state.status) {
    case 'saved':
      return recorded(state, original)
    case 'refused':
      return refusals[state.reason]
    case 'failed':
      return failure
    default:
      return waiting[state.status]
  }
}

/**
 * What a polite live region announces once a save settles, or nothing while
 * one is still on its way. A saved review says so and says it is not
 * completed, so nobody hears a mailbox action in it.
 */
export function reviewAnnouncement(state: ReviewState, original: string): string {
  if (state.status === 'choosing' || state.status === 'unsaved' || state.status === 'saving') {
    return ''
  }
  const { title, detail } = reviewResult(state, original)
  return state.status === 'saved' ? `${title}. ${detail} Not completed yet.` : `${title}. ${detail}`
}

/** Everything the panel says about one reviewable classification. */
export function reviewPanelCopy(labels: ClassificationLabels) {
  const unsure = labels.review === 'needs_review'
  const raised =
    labels.reviewPriority === 'elevated' ? ' It is marked as more urgent to look at.' : ''
  return {
    title: unsure ? 'Needs review' : 'Review this triage',
    summary: 'Confirm the category the model chose, or correct it. This records nothing in mail.',
    scoreLabel: 'Model score',
    score: labels.confidence * 100,
    reasonTitle: 'Why review?',
    reason: unsure
      ? `The model was unsure of this category, so it asked for a person.${raised}`
      : `The model accepted its own labels. Nothing is a person's decision until a review says so.${raised}`,
    originalLabel: 'Original AI suggestion',
    originalSuggestion: categoryLabels[labels.category],
    originalNote: 'This original suggestion is kept, whatever you decide.',
    categoriesTitle: 'Choose the right category',
    categoriesHint: "This reviews the message. It doesn't complete it.",
    saveLabel: 'Save review',
  } as const
}
