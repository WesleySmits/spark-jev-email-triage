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
 * - `classificationView` and `rowState` turn one state into the words and the
 *   tone the reader and the queue show. Every state is named in text, never
 *   by color alone, and nothing here claims more than its state holds: a
 *   probability is never shown, and `auto_accepted` reads as the model's own
 *   label, never as a review by a person.
 *
 * Nothing here reads a mailbox, a store or a classifier.
 */
import type { MailboxCopyRef } from '../../../domain/mailbox-copy'
import { mailboxCopyId } from '../../../domain/mailbox-copy'
import type { BodyState } from './body'
import type {
  ClassificationLabels,
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
}>

/** What applies to each row of one reading. */
export type Evidence = Readonly<{
  /** What applies to the open row, including what its own body read proved. */
  open: StoredClassification | undefined
  /** What applies to any row, open or not. */
  of: (id: string) => StoredClassification | undefined
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
): Evidence {
  const stored = (id: string) => listed?.states[id]
  const proves =
    listed !== undefined &&
    body.status === 'ready' &&
    body.id === openId &&
    body.reading === listed.reading
  const open =
    openId === undefined
      ? undefined
      : evidenceFor(stored(openId), proves ? body.classification : undefined)
  return { open, of: (id) => (id === openId ? open : stored(id)) }
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
function reviewFact({ review, reviewPriority }: ClassificationLabels): ClassificationFact {
  const raised = reviewPriority === 'elevated' ? ' Marked as more urgent to look at.' : ''
  if (review === 'needs_review') {
    return { term: 'Review', value: 'Needs a person', note: `The model was unsure.${raised}` }
  }
  return {
    term: 'Review',
    value: 'Accepted by the model',
    note: `No person has reviewed this.${raised}`,
  }
}

function factsOf(labels: ClassificationLabels): readonly ClassificationFact[] {
  return [
    { term: 'Category', value: categoryLabels[labels.category] },
    {
      term: 'Priority',
      value: priorities[labels.priority],
      ...(labels.priorityUncertain && { note: 'The model was not sure of this priority.' }),
    },
    reviewFact(labels),
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

/** Everything the reader shows for one row's evidence. */
export function classificationView(classification: StoredClassification): ClassificationView {
  return {
    state: states[classification.state],
    detail: detailOf(classification),
    facts: 'labels' in classification ? factsOf(classification.labels) : [],
    ...('judgedAt' in classification && { judgedAt: classification.judgedAt }),
    ...(classification.state === 'provider_failure' &&
      classification.errorCode !== null && { note: `Reported: ${classification.errorCode}` }),
  }
}

/** What one queue row shows: its state, and the category when labels apply. */
export function rowState(classification: StoredClassification) {
  return {
    status: states[classification.state],
    category:
      'labels' in classification ? categoryLabels[classification.labels.category] : undefined,
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
