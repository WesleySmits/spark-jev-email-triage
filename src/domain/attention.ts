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
 * - A person's decision beats the model's advice. Where a review names the
 *   version a row shows, its labels decide the state, and the model's own
 *   labels stay beside them as advice so both remain legible.
 * - Only a judgment that still describes the row may steer it. One a reading
 *   proved `current`, or one the store holds and contradicts in no way, is
 *   reliable enough to place a row. A stale judgment, a failed attempt, a
 *   row nothing judged and a store that could not be read are all
 *   `unclassified`: their old or missing labels never place a row as if
 *   they held, and the cause stays named so it is never mistaken for a row
 *   that was simply never triaged.
 * - A judgment triage policy asked a person to look at stays `needs_review`
 *   until a person has reviewed that version. Its labels, urgent included,
 *   place nothing until then: a priority nobody trusts is not a priority.
 * - Every tally counts rows it was given and says which reach they came from.
 *   A reading that was bounded or lost a mailbox counts what was loaded and
 *   says so; only a reading that read everything it listed, unbounded and
 *   without failure, counts a proven scope. A count is never of a mailbox.
 */
import type { ReviewedLabels } from './review'
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
 * What a person decided about the version a row shows. Structurally the
 * reviewer branch of the row's effective outcome, so a page may pass what
 * a reading projected without converting it.
 */
export type AttentionReview = Readonly<{
  decision: 'confirmed' | 'corrected'
  labels: ReviewedLabels
}>

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
  /** The labels that placed the row: a person's where one decided, else the model's. */
  labels: ReviewedLabels
  /** Whose labels those are. Priority is never assessed by a category review. */
  decidedBy: 'reviewer' | 'classifier'
  /** What the model proposed, kept beside a person's decision as advice. */
  advice: ReviewedLabels
  /** Whether a read proved the judgment current, or the store alone holds it. */
  evidence: AttentionEvidence
}>

/** One row's attention: placed by a judgment that holds, or not placeable. */
export type Attention =
  PlacedAttention | Readonly<{ state: 'unclassified'; cause: UnclassifiedCause }>

const unclassified = (cause: UnclassifiedCause): Attention => ({ state: 'unclassified', cause })

/**
 * Categories the rubric defines as needing no action of themselves. A row
 * filed there is informational whatever priority travels with it: a category
 * a person chose was chosen over the model's priority, which no category
 * review assesses, and a model that files mail as a promotion while calling
 * it urgent has contradicted its own rubric.
 */
const informationalCategories: ReadonlySet<ClassificationLabels['category']> = new Set([
  'newsletter',
  'promotion',
])

const pressingPriorities: ReadonlySet<ClassificationLabels['priority']> = new Set([
  'urgent',
  'high',
])

/** The state the labels that hold for a row place it in. */
function placeBy({ category, priority }: ReviewedLabels): PlacedAttention['state'] {
  if (informationalCategories.has(category)) return 'informational'
  if (pressingPriorities.has(priority)) return 'high_priority'
  return priority === 'low' ? 'informational' : 'attention'
}

/**
 * The attention one row asks for, from the classification a reading holds
 * for it and, where a person reviewed that exact version, their decision.
 *
 * Pass the review only when it names the version the classification shows.
 * The page already scopes reviews that way; a review of another version or
 * copy decides nothing about this row and must not be passed here.
 */
export function attentionOf(
  classification: StoredClassification | undefined,
  review?: AttentionReview,
): Attention {
  if (classification === undefined) return unclassified('none')
  switch (classification.state) {
    case 'none':
    case 'stale':
    case 'provider_failure':
    case 'unavailable':
      return unclassified(classification.state)
    case 'current':
    case 'unverified':
      return placed(classification.labels, classification.state, review)
  }
}

function placed(
  labels: ClassificationLabels,
  evidence: AttentionEvidence,
  review: AttentionReview | undefined,
): PlacedAttention {
  const advice: ReviewedLabels = { category: labels.category, priority: labels.priority }
  if (review === undefined) {
    return {
      state: labels.review === 'needs_review' ? 'needs_review' : placeBy(advice),
      labels: advice,
      decidedBy: 'classifier',
      advice,
      evidence,
    }
  }
  return {
    state: placeBy(review.labels),
    labels: review.labels,
    decidedBy: 'reviewer',
    advice,
    evidence,
  }
}

/** Where a state sorts in a worklist: lower comes first. */
export const attentionRank = (state: AttentionState) => attentionStates.indexOf(state)

/**
 * What one reading could and could not reach, as the tally needs it. The
 * page's queue scope carries these already; nothing else is read.
 */
export type TallyReach = Readonly<{
  /** Whether a bound may have cut the reading. */
  bounded: boolean
  /** Mailboxes that could not be read at all. */
  failed: readonly unknown[]
  /** Mailboxes whose later pages could not be read. */
  incomplete?: readonly unknown[] | undefined
}>

/**
 * How far a tally reaches:
 * - `loaded`: it counts the rows this reading loaded, and older mail or a
 *   mailbox that could not be read may hold more. Never read as a total.
 * - `proven`: the reading read every mailbox it listed to the end, so the
 *   count is of everything that reading could have shown.
 */
export type TallyReachKind = 'loaded' | 'proven'

/** Whether a reading's tally counts a proven scope or only what was loaded. */
export function tallyReachOf(reach: TallyReach): TallyReachKind {
  const incomplete = reach.incomplete?.length ?? 0
  return reach.bounded || reach.failed.length > 0 || incomplete > 0 ? 'loaded' : 'proven'
}

export type AttentionTally = Readonly<{
  /** Rows in each state. Every state is present, at zero where none is. */
  counts: Readonly<Record<AttentionState, number>>
  /** Rows counted in all: exactly the rows given, so the counts sum to it. */
  total: number
  reach: TallyReachKind
}>

/**
 * How many rows ask for each kind of attention, among the rows given, and
 * how far that count reaches. Pass exactly the rows the reading loaded, or
 * the rows a filter shows: the tally is of those rows and claims nothing
 * about any it was not given.
 */
export function tallyAttention(attention: readonly Attention[], reach: TallyReach): AttentionTally {
  const counts = Object.fromEntries(attentionStates.map((state) => [state, 0])) as Record<
    AttentionState,
    number
  >
  for (const { state } of attention) counts[state] += 1
  return { counts, total: attention.length, reach: tallyReachOf(reach) }
}
