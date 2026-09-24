/**
 * How the workbench shows what shadow triage stored about a row.
 *
 * Two jobs, both plain functions of plain data:
 *
 * - `evidenceIn` and `evidenceFor` decide which evidence a row has. A reading
 *   lists what the store alone can say, and opening a row adds what the
 *   thread its body read returned proved. The store alone never proves
 *   currency, so only a body read can answer `current`, and only for the
 *   judgment the listing named, under the reading that read ran in.
 * - `classificationView` and `rowState` turn one state, and what a person
 *   decided about it, into the words and the tone the reader and the queue
 *   show. Every state is named in text, never by color alone, and nothing
 *   here claims more than its state holds: a probability is never shown, and
 *   `auto_accepted` reads as the model's own label, never as a review by a
 *   person. Where someone did review, their labels are what the row shows,
 *   and the model's own suggestion stays beside them rather than being
 *   replaced.
 *
 * Nothing here reads a mailbox, a store or a classifier.
 */
import type { RowReview } from '../../../app/desk-review'
import type { MailboxCopyRef } from '../../../domain/mailbox-copy'
import { mailboxCopyId } from '../../../domain/mailbox-copy'
import { sameSubject } from '../../../domain/review'
import type { BodyState } from './body'
import type {
  ClassificationLabels,
  JudgedSubject,
  StoredClassification,
} from '../../../domain/stored-classification'
import type { Badge } from '../../atoms/Badge/Badge'

type BadgeTone = NonNullable<Parameters<typeof Badge>[0]['tone']>

type Unverified = Extract<StoredClassification, { state: 'unverified' }>
type Judged = Extract<StoredClassification, { state: 'current' | 'stale' }>

/** Whether two judgments are the same one: the same version, judged at the same moment. */
function namesSameJudgment(listed: Unverified, read: Judged) {
  const a = listed.subject
  const b = read.subject
  return (
    read.judgedAt === listed.judgedAt &&
    sameCopy(a.copy, b.copy) &&
    a.threadId === b.threadId &&
    a.latestMessageId === b.latestMessageId &&
    a.rubric === b.rubric &&
    a.classifierVersion === b.classifierVersion
  )
}

const sameCopy = (a: MailboxCopyRef, b: MailboxCopyRef) => mailboxCopyId(a) === mailboxCopyId(b)

/**
 * What one row's evidence is: what the reading listed, and for the row whose
 * body was read, what that read proved about it.
 *
 * A body read answers a listing; it is never a listing of its own. Only an
 * `unverified` listing can be answered, and only by a read that names the
 * very judgment that listing named. So a judgment the store already
 * contradicts is never promoted back, a verification that belonged to an
 * earlier reading is dropped once a refresh lists something else, and a row
 * the reading listed nothing about shows nothing, whatever a body carried:
 * what the page shows is always something a reading listed.
 */
export function evidenceFor(
  listed: StoredClassification | undefined,
  read: StoredClassification | undefined,
): StoredClassification | undefined {
  // Nothing listed, or nothing listed that a read may answer: what the
  // reading said stands, and with no reading there is nothing to show.
  if (listed?.state !== 'unverified' || read === undefined) return listed
  if (read.state !== 'current' && read.state !== 'stale') return listed
  return namesSameJudgment(listed, read) ? read : listed
}

/**
 * One reading of the desk as the page is shown it: what it listed about each
 * row, and which reading that was. The two travel together, so evidence can
 * never be shown without knowing the reading it belongs to.
 */
export type ListedEvidence = Readonly<{
  /** Opaque id of the reading. A new reading, a refresh included, gets a new one. */
  reading: string
  /** What the reading listed about each row, by the row's id. */
  states: Readonly<Record<string, StoredClassification>>
  /**
   * What a person decided about each row, where anyone has, by the row's id.
   * The reading projected it from the reviews stored for that row's mailbox
   * copy, keeping only those that named the very classification it listed, so
   * a review of another copy or of a version that has moved on is not here.
   * Left out: nothing was reviewed, or the reading does not say.
   */
  reviews?: Readonly<Record<string, RowReview>> | undefined
}>

/**
 * A review recorded from this page since the reading, and the version it
 * named. The store answered the save with it, so it is the store's own
 * projection of that row: nothing here invents a reviewer or a time.
 *
 * It lets a row show what was just decided without the mailbox being listed
 * again, and it is scoped like every other answer: it decides a row only
 * while that row is still showing the version it named.
 */
export type RecordedReview = Readonly<{ subject: JudgedSubject; review: RowReview }>

/** Every review recorded from this page since the reading, by the row's id. */
export type RecordedReviews = Readonly<Record<string, RecordedReview>>

/** Whether a recorded review names the version a row is showing. */
const namesShown = (recorded: RecordedReview, shown: StoredClassification | undefined) =>
  shown !== undefined && 'subject' in shown && sameSubject(recorded.subject, shown.subject)

/** The later of two answers about one row, by when each was decided. */
const later = (a: RowReview, b: RowReview) =>
  Date.parse(a.reviewedAt) >= Date.parse(b.reviewedAt) ? a : b

/** What applies to each row of one reading. */
export type Evidence = Readonly<{
  /** What applies to the open row, including what its own body read proved. */
  open: StoredClassification | undefined
  /** What a person decided about the open row, where anyone has. */
  openReview: RowReview | undefined
  /** What applies to any row, open or not. */
  of: (id: string) => StoredClassification | undefined
  /** What a person decided about any row, open or not, where anyone has. */
  reviewOf: (id: string) => RowReview | undefined
}>

/**
 * What is known about each row of one reading, and about the open row also
 * what the body held for it proved.
 *
 * A proof counts only where it still is one. There must be a reading to
 * answer, it must name the open row, be the body held for it, and come from
 * a request that ran under this very reading: a later reading listed the
 * mailbox again, the provider may have moved on since, and nothing reads a
 * thread again to find out. So a refresh drops back to what the store alone
 * says until the reader opens that thread anew, and the same reading
 * rendered again keeps what it proved.
 *
 * A proof answers a listing and never stands in for one. With no reading, or
 * none that listed the open row, there is nothing to show: a body may still
 * carry what its thread proved, but nothing here would say what it proved it
 * about.
 */
export function evidenceIn(
  listed: ListedEvidence | undefined,
  openId: string | undefined,
  body: BodyState,
  recorded: RecordedReviews = {},
): Evidence {
  const stored = (id: string) => listed?.states[id]
  const reviewed = (id: string) => listed?.reviews?.[id]
  const read =
    listed !== undefined &&
    body.status === 'ready' &&
    body.id === openId &&
    body.reading === listed.reading
      ? body
      : undefined
  const open = openId === undefined ? undefined : evidenceFor(stored(openId), read?.classification)
  // A review a body read carries was projected from the judgment that read
  // named, and decides that judgment alone. So it counts only where that
  // judgment is the one being shown: a read naming another version is not
  // promoted above, and its reviewer's decision must not be shown beside the
  // version that stayed either. What the reading listed stands instead.
  //
  // Where the read did answer the listing, it read the store as it is now, so
  // a review saved since shows without anything being listed again. A read
  // that carries none adds nothing and never takes the listing's answer away:
  // reviews are only ever appended, and the read names the version the
  // listing named, so it has no way of finding that a listed one has gone. A
  // loader that carries no reviews at all, as fixtures do, is the same case.
  const answering =
    read?.classification !== undefined && read.classification === open ? read : undefined
  // A review this page recorded is the store's own answer to that save, so
  // it counts wherever the row is still showing the version it named, open
  // or not: the queue and the reader say what was decided at once, without
  // the mailbox being listed again. Where a reading carries an answer too,
  // the later of the two decides, as the store itself would.
  const withRecorded = (id: string, shown: StoredClassification | undefined) => {
    const found = id === openId ? (answering?.review ?? reviewed(id)) : reviewed(id)
    const own = recorded[id]
    if (own === undefined || !namesShown(own, shown)) return found
    return found === undefined ? own.review : later(found, own.review)
  }
  const openReview = openId === undefined ? undefined : withRecorded(openId, open)
  return {
    open,
    openReview,
    of: (id) => (id === openId ? open : stored(id)),
    reviewOf: (id) => (id === openId ? openReview : withRecorded(id, stored(id))),
  }
}

/** The state as the queue and the reader name it: always words, and a tone. */
export type ClassificationState = Readonly<{ label: string; tone: BadgeTone }>

const states = {
  current: { label: 'Triage current', tone: 'done' },
  unverified: { label: 'Triage from earlier', tone: 'neutral' },
  stale: { label: 'Triage outdated', tone: 'review' },
  provider_failure: { label: 'Triage failed', tone: 'danger' },
  none: { label: 'Not triaged', tone: 'neutral' },
  unavailable: { label: 'Triage unreadable', tone: 'neutral' },
} as const satisfies Record<StoredClassification['state'], ClassificationState>

/** How each rubric category reads. Shared with the review radiogroup. */
export const categoryLabels = {
  personal: 'Personal',
  notification: 'Notification',
  security: 'Security',
  purchase: 'Purchase',
  newsletter: 'Newsletter',
  promotion: 'Promotion',
  suspicious: 'Suspicious',
  other: 'Other',
} as const satisfies Record<ClassificationLabels['category'], string>

const priorities = {
  urgent: 'Urgent',
  high: 'High',
  normal: 'Normal',
  low: 'Low',
} as const satisfies Record<ClassificationLabels['priority'], string>

const staleReasons = {
  newer_message: 'A newer message arrived in this thread after it was judged.',
  other_snapshot: 'The thread read for this message is no longer the one that was judged.',
  rubric: 'It was judged under an older set of triage rules.',
  classifier: 'It was judged by an older classifier build.',
} as const

const unreadableReasons = {
  unsupported_schema:
    'What was stored was written by a version of this app that this one cannot read.',
  unreadable: 'What was stored could not be read. The mail itself is unaffected.',
} as const

/** One named value in the reader, e.g. Priority · High, with an optional aside. */
export type ClassificationFact = Readonly<{
  term: string
  value: string
  note?: string | undefined
}>

/** Everything the reader says about one row's stored judgment. */
export type ClassificationView = Readonly<{
  state: ClassificationState
  /** One line saying what the state means. It never claims the judgment is right. */
  detail: string
  /** Category, priority and review need. Empty whenever no labels apply. */
  facts: readonly ClassificationFact[]
  /** When it was judged, as an ISO instant. Left out when nothing was judged. */
  judgedAt?: string | undefined
  /** The coarse reason a provider failure reported, when it gave one. */
  note?: string | undefined
}>

/** Review need, as labels the model produced: `auto_accepted` is no review by a person. */
function modelReviewFact({ review, reviewPriority }: ClassificationLabels): ClassificationFact {
  const raised = reviewPriorityNote(reviewPriority)
  if (review === 'needs_review') {
    return { term: 'Review', value: 'Needs a person', note: `The model was unsure.${raised}` }
  }
  return {
    term: 'Review',
    value: 'Accepted by the model',
    note: `No person has reviewed this.${raised}`,
  }
}

const decisions = {
  confirmed: 'Confirmed by a person',
  corrected: 'Corrected by a person',
} as const

const reviewPriorityNote = (priority: ClassificationLabels['reviewPriority']) =>
  priority === 'elevated' ? ' Marked as more urgent to look at.' : ''

/** The category panel makes no decision about any other classification field. */
export const categoryReviewScopeNote =
  'This review covers the category only. Priority and reply expectations are not confirmed.'

/**
 * Name the category decision, who made it and when. Other model signals
 * still apply: recording a category review does not assess another field.
 */
const personReviewFact = (review: RowReview, labels: ClassificationLabels): ClassificationFact => ({
  term: 'Category review',
  value: decisions[review.decision],
  note: `By ${review.reviewer} on ${judgedText(review.reviewedAt)}. ${categoryReviewScopeNote} Your mail is unchanged.${reviewPriorityNote(labels.reviewPriority)}`,
})

/**
 * What the row shows for category, and where a person chose it, the model's
 * own suggestion beside it. The suggestion is never replaced: a correction is
 * added to what was judged, and both stay readable.
 */
function categoryFact(
  labels: ClassificationLabels,
  review: RowReview | undefined,
): ClassificationFact {
  const suggested = categoryLabels[labels.category]
  if (review === undefined) return { term: 'Category', value: suggested }
  const chosen = categoryLabels[review.labels.category]
  return {
    term: 'Category',
    value: chosen,
    note:
      review.decision === 'confirmed'
        ? `A person confirmed the model's suggestion, ${suggested}.`
        : `Chosen by a person. The model suggested ${suggested}.`,
  }
}

function factsOf(
  labels: ClassificationLabels,
  review: RowReview | undefined,
): readonly ClassificationFact[] {
  const priority = review?.labels.priority ?? labels.priority
  return [
    categoryFact(labels, review),
    {
      term: 'Priority',
      value: priorities[priority],
      ...(labels.priorityUncertain && { note: 'The model was not sure of this priority.' }),
    },
    review === undefined ? modelReviewFact(labels) : personReviewFact(review, labels),
  ]
}

const detailOf = (classification: StoredClassification) => {
  switch (classification.state) {
    case 'current':
      return 'Checked against the thread that was read for this message.'
    case 'unverified':
      return 'Stored by an earlier triage run. Nothing here read the thread, so it is not confirmed for the message as it stands now.'
    case 'stale':
      return `${staleReasons[classification.reason]} The labels below are the ones it was given then.`
    case 'provider_failure':
      return 'The classifier did not answer for this message, so nothing was judged.'
    case 'none':
      return 'No triage run has stored anything for this message.'
    case 'unavailable':
      return unreadableReasons[classification.reason]
  }
}

/**
 * Everything the reader shows for one row's evidence, and for what a person
 * decided about it. A review decides the labels shown; the state beside them
 * stays what it is, because reviewing a judgment does not make it current.
 */
export function classificationView(
  classification: StoredClassification,
  review?: RowReview,
): ClassificationView {
  return {
    state: states[classification.state],
    detail: detailOf(classification),
    facts: 'labels' in classification ? factsOf(classification.labels, review) : [],
    ...('judgedAt' in classification && { judgedAt: classification.judgedAt }),
    ...(classification.state === 'provider_failure' &&
      classification.errorCode !== null && { note: `Reported: ${classification.errorCode}` }),
  }
}

/**
 * What one queue row shows: its state, and the category when labels apply.
 * Where a person decided the category, that is the one the row shows, so a
 * list read after a correction shows what it was corrected to.
 */
export function rowState(classification: StoredClassification, review?: RowReview) {
  const labels = review?.labels ?? ('labels' in classification ? classification.labels : undefined)
  return {
    status: states[classification.state],
    category: labels && categoryLabels[labels.category],
  } as const
}

const judgedFormat = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
})

/** When a judgment was made, in the reader's own zone, e.g. "22 Sep, 09:15". */
export const judgedText = (judgedAt: string) => judgedFormat.format(new Date(judgedAt))
