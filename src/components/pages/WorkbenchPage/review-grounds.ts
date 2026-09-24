/**
 * Why triage asked a person to look at one judgment, in words.
 *
 * Four things a reader could easily confuse are deliberately kept apart, and
 * separating them is what this module is for:
 *
 * - What the classifier scored. A category score, and nothing more. A score is
 *   never reported as a finding: policy admits a suspicion signal from a
 *   deliberately low floor, so every line for one is hedged.
 * - What policy decided from those scores: to ask a person, and whether to
 *   raise how urgent that is. Policy is ordinary code in this application,
 *   so its decision is never reported as the model's account of itself.
 * - Whether the judgment still describes the mail. That is the state around
 *   these labels and lives in `classification.ts`; no ground says anything
 *   about it, and a stale judgment's grounds explain what was decided then.
 * - What a person made of it. A review decides labels beside a judgment and
 *   never becomes one of its grounds.
 *
 * No mail or model text can reach a reader through any of this. Every line is
 * this module's own copy, chosen by a code from a closed set that the rubric
 * defines; a record naming a code this build does not know reads as unknown
 * instead of being printed. So a sender's claimed label, or an instruction
 * written into a mail for an automated reader, has no way through: the codes
 * carry no text to show, inert or otherwise.
 *
 * Plain functions of plain data. Nothing here reads a store or a mailbox.
 */
import type { ClassificationLabels, ReviewGrounds } from '../../../domain/stored-classification'
import type { ReviewReason, SuspicionSignal } from '../../../domain/triage'

type Recorded = Extract<ReviewGrounds, { state: 'recorded' }>

/** What each policy rule weighed, one line each, in this application's words. */
const reasonLines = {
  low_category_confidence:
    "The model's score for this category stayed under the level triage accepts on its own.",
  ambiguous_category:
    'The model answered Other, which means either that no category of the rubric clearly fits or that the thread does not hold enough to tell. The record does not say which.',
  suspicious: 'Triage read this mail as a possible scam or phishing attempt.',
} as const satisfies Record<ReviewReason, string>

/** The same rules, short enough to name beside each other in the reader. */
const reasonNames = {
  low_category_confidence: 'Low category score',
  ambiguous_category: 'Answered Other',
  suspicious: 'Possible scam or phishing',
} as const satisfies Record<ReviewReason, string>

/**
 * What each suspicion judgment may have found, hedged on purpose.
 *
 * Policy admits a signal from `suspicionFloor`, which the rubric sets low
 * deliberately, so one fires well below even odds: at the floor it is likelier
 * wrong than right. None of these lines may therefore say a mail asks for a
 * credential or that an address does not match, only that it may. Overclaiming
 * here is the same error as explaining every review as model doubt.
 *
 * Each describes the mail in this module's words and never quotes it, so
 * nothing a sender wrote is shown.
 */
const signalLines = {
  credential_request: 'It may ask for a password, a login code or another credential.',
  sender_impersonation: "A sender's address may not match the identity the mail claims.",
  payment_redirect: 'It may ask to send money or to change payment details.',
  automated_reader_instructions: 'It may carry instructions addressed to an automated reader.',
} as const satisfies Record<SuspicionSignal, string>

/** Said wherever signals are listed, so none of them reads as established. */
const signalsAreScores = 'Each is a possibility the model scored, not a checked finding.'

/** Policy's own decision about how urgent looking at this is. */
const raisedLine =
  'Triage raised how urgent a look is, which asks for attention sooner and nothing else.'

/**
 * The copy for the codes in `codes`, in the order this module lists them
 * rather than the order they were stored in, so the same grounds always read
 * the same way. A code appearing twice is said once.
 */
function lines<Code extends string>(
  copy: Record<Code, string>,
  codes: readonly Code[],
): readonly string[] {
  const known = Object.keys(copy) as Code[]
  return known.filter((code) => codes.includes(code)).map((code) => copy[code])
}

/** Everything the review panel says about why a person was asked. */
export type ReviewGroundsCopy = Readonly<{
  /** Who asked, and on what kind of evidence. Always said, grounds or not. */
  lead: string
  /** One line per recorded ground. Empty where the record names none. */
  grounds: readonly string[]
}>

const leads = {
  asked:
    "Triage policy asked for a person on the grounds below. Each is a rule over the model's scores, not the model's own account of itself, and none of them says whether this triage still describes the mail as it stands now.",
  accepted:
    "Triage policy accepted the model's own labels, so no rule asked for a person. Nothing is a person's decision until a review says so.",
  unknownAsked:
    'Triage policy asked for a person, but what was stored does not say on what grounds. It was written without them, or by a build whose grounds this one cannot read, so none is shown rather than guessed at.',
  unknownAccepted:
    "Triage policy accepted the model's own labels. What was stored does not say what it weighed, so nothing is shown rather than guessed at.",
} as const

/** Every ground one judgment recorded, in a fixed order. */
const groundLines = (
  grounds: Recorded,
  reviewPriority: ClassificationLabels['reviewPriority'],
): readonly string[] => [
  ...lines(reasonLines, grounds.reasons),
  ...lines(signalLines, grounds.suspicionSignals).map((line) => `Possible signal: ${line}`),
  ...(reviewPriority === 'elevated' ? [raisedLine] : []),
]

/**
 * What the panel says about why this judgment is being offered for review.
 *
 * A judgment the model accepted is still offered, and says so: the panel is
 * how a person reviews a category, not a warning of its own.
 */
export function reviewGroundsCopy(labels: ClassificationLabels): ReviewGroundsCopy {
  const asked = labels.review === 'needs_review'
  const { grounds } = labels
  if (grounds.state === 'unknown') {
    return { lead: asked ? leads.unknownAsked : leads.unknownAccepted, grounds: [] }
  }
  return {
    lead: asked ? leads.asked : leads.accepted,
    grounds: groundLines(grounds, labels.reviewPriority),
  }
}

/** One named value for the reader: a short value, and a line under it. */
export type GroundsFact = Readonly<{ value: string; note: string }>

const unrecordedFact: GroundsFact = {
  value: 'Not recorded',
  note: 'What was stored does not say why, so none is shown rather than guessed at. The judgment itself is unaffected.',
}

/**
 * The grounds as the reader names them, or nothing to add.
 *
 * The reader shows this wherever a judgment has labels, including one that is
 * outdated and offers no panel at all: what was decided then is still the
 * only account of why, and it stays readable.
 *
 * How urgent a look is deliberately left out. The reader already says that
 * beside the review need itself, and saying it twice in one strip would read
 * as two findings where policy made one decision.
 */
export function reviewGroundsFact(labels: ClassificationLabels): GroundsFact | undefined {
  const { grounds } = labels
  if (grounds.state === 'unknown') return unrecordedFact
  const named = lines(reasonNames, grounds.reasons)
  if (named.length === 0) return undefined
  return {
    value: named.join(' · '),
    note: groundLines(grounds, 'normal').join(' '),
  }
}

/**
 * The scam-or-phishing warning one judgment carries, or nothing.
 *
 * It is independent of the category, and that is why it is its own value. What
 * a sender asked for does not change because someone filed the mail elsewhere,
 * so a person correcting or confirming the category clears none of it; the
 * note says as much, so nobody reads a saved review as having answered it.
 *
 * A record whose grounds are unknown claims no warning. Absence of a recorded
 * signal is not evidence that a mail is safe, and this says nothing either way
 * rather than inventing reassurance.
 */
export function suspicionWarning(labels: ClassificationLabels): GroundsFact | undefined {
  const { grounds } = labels
  if (grounds.state !== 'recorded') return undefined
  const signals = lines(signalLines, grounds.suspicionSignals)
  if (!grounds.reasons.includes('suspicious') && signals.length === 0) return undefined
  // The category is a label the store holds, so it is said plainly; a signal is
  // a score over a low floor, so it is hedged and named as one.
  const found =
    signals.length > 0
      ? `${signals.join(' ')} ${signalsAreScores}`
      : 'The model placed this mail in Suspicious.'
  return {
    value: 'Possible scam or phishing',
    note: `${found} This stands whatever category a person decides on.`,
  }
}
