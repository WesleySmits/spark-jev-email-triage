/**
 * How the workbench turns each row's attention into a worklist: the group a
 * row sits in, the words that say why, and the counts each group shows.
 *
 * Plain functions of plain data, like `classification.ts` beside it. The
 * attention itself is decided in `domain/attention.ts`; this module only
 * orders rows by it, names the groups and writes one line per row that
 * says who placed it there and on what. Every line keeps the model's advice
 * and a person's decision apart in words, never by colour alone, and none
 * of them quotes mail: a category and a priority are this application's
 * labels, chosen by codes from a closed set.
 *
 * A group count is of the rows it was given and says so. Only a reading the
 * app proved complete counts everything a view holds; a bounded or partly
 * failed reading counts what was loaded, and a filtered list counts what
 * the filter kept. Nothing here reads a mailbox or moves a message.
 */
import type { RowReview } from '../../../app/desk-review'
import {
  attentionOf,
  attentionRank,
  attentionStates,
  tallyAttention,
  type Attention,
  type AttentionState,
  type PlacedAttention,
  type TallyCoverage,
} from '../../../domain/attention'
import type { StoredClassification } from '../../../domain/stored-classification'
import { categoryLabels, priorityLabels } from './classification'
import type { WorkbenchMessage } from './workbench'

/** How each group is titled, in the queue and in the reader. */
const attentionTitles = {
  needs_review: 'Needs review',
  high_priority: 'High priority',
  attention: 'Attention',
  unclassified: 'Not triaged',
  informational: 'Informational',
} as const satisfies Record<AttentionState, string>

/**
 * The attention of one row, from what the reading listed about it and what
 * a person decided. A row the reading listed nothing about is unjudged as
 * far as this page can tell, and is grouped as not triaged; its own status
 * badge still says what it came with.
 */
export function rowAttention(
  classification: StoredClassification | undefined,
  review: RowReview | undefined,
): Attention {
  return attentionOf(classification ?? { state: 'none' }, review)
}

const unclassifiedReasons = {
  none: 'Not triaged. No run has stored anything for this message, so nothing places it.',
  stale:
    'Triage outdated. The stored judgment no longer describes this message, so its old labels place nothing.',
  provider_failure: 'Triage failed. The classifier did not answer, so nothing was judged.',
  unavailable: 'Triage unreadable. What was stored could not be read, so nothing places it.',
} as const

const byWhom = (by: PlacedAttention['categoryBy']) =>
  by === 'reviewer' ? 'decided by a person' : "the model's"

/** The labels that hold, each with who decided it, e.g. "Personal, decided by a person". */
function labelsLine(placed: PlacedAttention) {
  const category = `${categoryLabels[placed.category]}, ${byWhom(placed.categoryBy)}`
  const priority = `priority ${priorityLabels[placed.priority]}, ${byWhom(placed.priorityBy)}`
  return `${category}; ${priority}.`
}

/** What the model proposed, said wherever a person decided something else. */
const adviceLine = ({ advice }: PlacedAttention) =>
  `Model advice: ${categoryLabels[advice.category]}, ${priorityLabels[advice.priority]}.`

const warningLine = 'Possible scam or phishing, whatever it is filed as.'

/**
 * One line saying why a row sits in its group. It names the labels that
 * placed it and who decided each, the model's advice where a person decided
 * otherwise, and the signals policy recorded. Nothing here claims more than
 * the record holds: a possible scam is a scored possibility, and a priority
 * the model was unsure of says so.
 */
export function attentionReason(attention: Attention): string {
  if (attention.state === 'unclassified') return unclassifiedReasons[attention.cause]
  const reviewed = attention.categoryBy === 'reviewer' || attention.priorityBy === 'reviewer'
  const unsure =
    attention.priorityUncertain && attention.priorityBy === 'classifier'
      ? 'The model was not sure of its priority.'
      : undefined
  if (attention.state === 'needs_review') {
    return [
      `Policy asked for a person${attention.elevated ? ', sooner' : ''}. No person has reviewed it.`,
      attention.warning ? warningLine : undefined,
      adviceLine(attention),
      unsure,
    ]
      .filter((line) => line !== undefined)
      .join(' ')
  }
  return [
    labelsLine(attention),
    reviewed ? adviceLine(attention) : undefined,
    attention.warning ? warningLine : undefined,
    unsure,
  ]
    .filter((line) => line !== undefined)
    .join(' ')
}

/** How far a group's count reaches, in the words its note uses. */
type GroupReach =
  /** The reading was bounded or partly failed: the count is of loaded rows. */
  | Readonly<{ kind: 'loaded' }>
  /** The reading was proved complete: the count is of every message the view holds. */
  | Readonly<{ kind: 'proven'; view: string }>
  /** A filter kept these rows: the count is of what it kept. */
  | Readonly<{ kind: 'filtered' }>

/** One group of the worklist, in worklist order. */
export type AttentionGroup = Readonly<{
  state: AttentionState
  title: string
  /** The count and its reach, e.g. "2 of 10 loaded". */
  note: string
  messages: readonly WorkbenchMessage[]
}>

function noteFor(count: number, total: number, reach: GroupReach) {
  const of = `${String(count)} of ${String(total)}`
  switch (reach.kind) {
    case 'loaded':
      return `${of} loaded`
    case 'proven':
      return `${of} ${reach.view}`
    case 'filtered':
      return `${of} in this filter`
  }
}

/** Rows in worklist order: by attention first, then as the caller ordered them. */
export function orderByAttention(
  messages: readonly WorkbenchMessage[],
  attentionOfRow: (id: string) => Attention,
): readonly WorkbenchMessage[] {
  return [...messages].sort(
    (a, b) => attentionRank(attentionOfRow(a.id).state) - attentionRank(attentionOfRow(b.id).state),
  )
}

/** What the worklist's counts are of, and how far they reach. */
export type WorklistScope = Readonly<{
  /** What the app proved about the reading. Left out: nothing was proved. */
  coverage?: TallyCoverage | undefined
  /** Whether a mailbox filter or a search narrowed the rows. */
  filtered: boolean
  /** What the view holds, for a proven count, e.g. "unread messages". */
  view: string
}>

/**
 * The reach a worklist's counts have. A filter narrows what the coverage
 * proved, so a filtered list counts what the filter kept whatever the
 * reading proved; otherwise the tally's own reach decides.
 */
function reachOf(tally: ReturnType<typeof tallyAttention>, scope: WorklistScope): GroupReach {
  if (scope.filtered) return { kind: 'filtered' }
  return tally.reach === 'proven' ? { kind: 'proven', view: scope.view } : { kind: 'loaded' }
}

/**
 * The worklist as groups, every group present in worklist order so the
 * counts read as one tally even where a group holds nothing. Pass rows
 * already in worklist order; each group keeps that order.
 */
export function groupByAttention(
  ordered: readonly WorkbenchMessage[],
  attentionOfRow: (id: string) => Attention,
  scope: WorklistScope,
): readonly AttentionGroup[] {
  const tally = tallyAttention(
    ordered.map((message) => attentionOfRow(message.id)),
    scope.coverage ?? { result: 'incomplete' },
  )
  const reach = reachOf(tally, scope)
  return attentionStates.map((state) => ({
    state,
    title: attentionTitles[state],
    note: noteFor(tally.counts[state], tally.total, reach),
    messages: ordered.filter((message) => attentionOfRow(message.id).state === state),
  }))
}

/**
 * The first row of the group after the one `id` sits in, or nothing at the
 * last group with rows. Without a current row, the first row of the list.
 */
export function nextGroupStart(
  ordered: readonly WorkbenchMessage[],
  id: string | undefined,
  attentionOfRow: (id: string) => Attention,
): string | undefined {
  const index = ordered.findIndex((message) => message.id === id)
  if (index === -1) return ordered[0]?.id
  const state = attentionOfRow(ordered[index]?.id ?? '').state
  return ordered.slice(index + 1).find((message) => attentionOfRow(message.id).state !== state)?.id
}
