/**
 * Which kind of attention one row asks for, read from what is stored about it.
 *
 * A worklist that steers attention needs one answer per row: is this mail
 * still unjudged, does its judgment need a person, is it high priority, is it
 * ordinary attention, or is it information only. That answer is derived here
 * and nowhere else, as a plain function of the stored classification a
 * reading holds for the row and of what a person decided about that exact
 * version. Nothing here reads a mailbox, a store or a classifier, and no
 * attention state moves, archives or completes a message: a state names what
 * a row asks of a person, never what the application did to the mail.
 *
 * Invariants:
 * - A person's decision beats the model's advice, for what the person
 *   decided. A review decides the category, the priority or both, one field
 *   at a time, so each field a person decided places the row and every other
 *   field stays the model's. The model's own labels stay beside the
 *   decision as advice, and a field nobody decided is never presented as a
 *   person's.
 * - Only a judgment that still describes the row may steer it. One a reading
 *   proved `current`, or one the store holds and contradicts in no way, is
 *   reliable enough to place a row. A stale judgment, a failed attempt, a
 *   row nothing judged and a store that could not be read are all
 *   `unclassified`: their old or missing labels never place a row as if
 *   they held, and the cause stays named so it is never mistaken for a row
 *   that was simply never triaged.
 * - A judgment triage policy asked a person to look at stays `needs_review`
 *   until a person has decided its category. Every ground policy records is
 *   about the category: a low score for it, an answer of Other, or a
 *   possible scam, so a decision about the priority alone leaves that
 *   question open. Its labels, urgent included, place nothing until then: a
 *   priority nobody trusts is not a priority.
 * - A suspicion policy recorded survives every review, as the reader's
 *   warning does. A row that may be a scam is never filed as information,
 *   whatever category a person decides on.
 * - Every tally counts the rows it was given and says which reach they came
 *   from. Only a reading the app already proved complete counts a proven
 *   scope; anything less counts what was loaded and says so. A count is
 *   never of a mailbox.
 */
import type { DecidedLabels, ReviewedLabels } from './review'
import { defaultRubric } from './rubric'
import type { ClassificationLabels, StoredClassification } from './stored-classification'

/**
 * The five kinds of attention, in the order a worklist steers them:
 * a judgment a person must look at first, then what is pressing, then
 * ordinary attention, then what nothing has judged yet, and last what only
 * informs. Unjudged mail sits before informational mail on purpose: nothing
 * is known about it, so it may be pressing, while informational mail is
 * placed there by a judgment that holds.
 */
export const attentionStates = [
  'needs_review',
  'high_priority',
  'attention',
  'unclassified',
  'informational',
] as const

export type AttentionState = (typeof attentionStates)[number]

/**
 * What a person decided about the version a row shows: the value of each
 * field their review settled on, and no field they did not decide.
 * Structurally the reviewer branch of the row's effective outcome, so a page
 * may pass what a reading projected without converting it.
 */
export type AttentionReview = Readonly<{ labels: DecidedLabels }>

/**
 * Why a row is unclassified. `none` is the only one that means nothing was
 * ever stored; the others say a judgment exists, or may, but cannot place the
 * row: it is outdated, the attempt failed, or what was stored could not be
 * read. Each is a state the row is in, never a claim about the mail.
 */
export type UnclassifiedCause = 'none' | 'stale' | 'provider_failure' | 'unavailable'

/** How a judgment that places a row was established. */
export type AttentionEvidence = 'current' | 'unverified'

/** A row placed by a judgment that holds, and by any review of it. */
export type PlacedAttention = Readonly<{
  state: Exclude<AttentionState, 'unclassified'>
  /** The category that placed the row: a person's where one decided, else the model's. */
  category: ReviewedLabels['category']
  /** Who decided that category. */
  categoryBy: 'reviewer' | 'classifier'
  /** The priority that placed the row: a person's where one decided, else the model's. */
  priority: ReviewedLabels['priority']
  /** Who decided that priority. */
  priorityBy: 'reviewer' | 'classifier'
  /** The model was unsure of its own priority. Shown, never acted on. */
  priorityUncertain: boolean
  /** What the model proposed, kept beside a person's decision as advice. */
  advice: ReviewedLabels
  /** Policy recorded a possible scam or phishing attempt. Survives every review. */
  warning: boolean
  /** Policy asked for a look sooner than usual, where it asked for one at all. */
  elevated: boolean
  /** Whether a read proved the judgment current, or the store alone holds it. */
  evidence: AttentionEvidence
}>

/** One row's attention: placed by a judgment that holds, or not placeable. */
export type Attention =
  PlacedAttention | Readonly<{ state: 'unclassified'; cause: UnclassifiedCause }>

const informational: ReadonlySet<string> = new Set(defaultRubric.informationalCategories)

const pressing: ReadonlySet<string> = new Set(['urgent', 'high'])

/**
 * Whether policy recorded a suspicion for a judgment. Unknown grounds claim
 * none: absence of a record is not evidence that a mail is safe, and this
 * says nothing either way rather than inventing reassurance.
 */
const warned = ({ grounds }: ClassificationLabels) =>
  grounds.state === 'recorded' &&
  (grounds.reasons.includes('suspicious') || grounds.suspicionSignals.length > 0)

/**
 * The state the labels that hold for a row place it in.
 *
 * Category first: mail the rubric files as information is information at any
 * priority, and mail read as a possible scam is pressing at any priority. Then
 * the priority, with one reservation: a low priority files a row as
 * information only where it can be trusted for the category that holds. A
 * person's own low priority can; the model's can only where the category is
 * still the one the model gave it to, because a person who corrected the
 * category decided nothing about a priority given to another one. A warning
 * keeps a row out of information whatever it is filed as.
 */
function placeBy(
  category: ReviewedLabels['category'],
  priority: ReviewedLabels['priority'],
  lowTrusted: boolean,
): PlacedAttention['state'] {
  if (informational.has(category)) return 'informational'
  if (category === 'suspicious' || pressing.has(priority)) return 'high_priority'
  return priority === 'low' && lowTrusted ? 'informational' : 'attention'
}

/**
 * The attention one row asks for, from the classification a reading holds
 * for it and, where a person reviewed that exact version, their decision.
 *
 * Pass the review only when it names the version the classification shows.
 * The page already scopes reviews that way; a review of another version or
 * copy decides nothing about this row and must not be passed here. A row the
 * reading listed nothing about is the caller's to name: `none` where it was
 * never stored, `unavailable` where the store could not be read.
 */
export function attentionOf(
  classification: StoredClassification,
  review?: AttentionReview,
): Attention {
  switch (classification.state) {
    case 'none':
    case 'stale':
    case 'provider_failure':
    case 'unavailable':
      return { state: 'unclassified', cause: classification.state }
    case 'current':
    case 'unverified':
      return placed(classification.labels, classification.state, review?.labels ?? {})
  }
}

/** Who decided one field: a person where the review carries a value for it. */
const decider = (value: unknown): PlacedAttention['categoryBy'] =>
  value === undefined ? 'classifier' : 'reviewer'

/**
 * The state a held judgment and a person's decisions place a row in. Policy's
 * request for a person is a question about the category, and stands until a
 * person decided the category of this version. A priority they decided is
 * kept and shown, but answers no question about the category.
 */
function stateOf(labels: ClassificationLabels, decided: DecidedLabels, warning: boolean) {
  if (decided.category === undefined && labels.review === 'needs_review') return 'needs_review'
  const category = decided.category ?? labels.category
  const lowTrusted = !warning && (decided.priority !== undefined || category === labels.category)
  return placeBy(category, decided.priority ?? labels.priority, lowTrusted)
}

function placed(
  labels: ClassificationLabels,
  evidence: AttentionEvidence,
  decided: DecidedLabels,
): PlacedAttention {
  const warning = warned(labels)
  return {
    state: stateOf(labels, decided, warning),
    category: decided.category ?? labels.category,
    categoryBy: decider(decided.category),
    priority: decided.priority ?? labels.priority,
    priorityBy: decider(decided.priority),
    priorityUncertain: labels.priorityUncertain,
    advice: { category: labels.category, priority: labels.priority },
    warning,
    elevated: labels.reviewPriority === 'elevated',
    evidence,
  }
}

/** Where a state sorts in a worklist: lower comes first. */
export const attentionRank = (state: AttentionState) => attentionStates.indexOf(state)

/**
 * How far a tally reaches:
 * - `loaded`: it counts the rows this reading loaded, and older mail or a
 *   mailbox that could not be read may hold more. Never read as a total.
 * - `proven`: the reading was proved complete, so the count is of everything
 *   that reading could have shown.
 */
export type TallyReach = 'loaded' | 'proven'

/**
 * What the app already proved about the reading the rows came from, as its
 * Inbox coverage states it: `complete` only where every listed mailbox was
 * read to the end without failure. That proof is made once, beside the
 * Inbox Zero verdict, and never restated here.
 */
export type TallyCoverage = Readonly<{ result: 'complete' | 'incomplete' | 'failed' }>

export type AttentionTally = Readonly<{
  /** Rows in each state. Every state is present, at zero where none is. */
  counts: Readonly<Record<AttentionState, number>>
  /** Rows counted in all: exactly the rows given, so the counts sum to it. */
  total: number
  reach: TallyReach
}>

/**
 * How many rows ask for each kind of attention, among the rows given, and
 * how far that count reaches. Pass every row of the reading: the reach
 * describes the reading, and a filtered subset is not what the coverage
 * proved. The tally claims nothing about rows it was not given.
 */
export function tallyAttention(
  attention: readonly Attention[],
  coverage: TallyCoverage,
): AttentionTally {
  const counts = Object.fromEntries(attentionStates.map((state) => [state, 0])) as Record<
    AttentionState,
    number
  >
  for (const { state } of attention) counts[state] += 1
  return {
    counts,
    total: attention.length,
    reach: coverage.result === 'complete' ? 'proven' : 'loaded',
  }
}
