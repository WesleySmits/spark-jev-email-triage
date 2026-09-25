/**
 * How the workbench asks a person to decide the fields of one classification,
 * and what it says while that is happening.
 *
 * Plain functions of plain data, like `classification.ts` beside it. Nothing
 * here reads a store, calls a classifier or touches a mailbox, and nothing
 * here saves: it decides which rows may be reviewed at all, what each field's
 * row currently amounts to, which fields one Save would record, and the words
 * for every state a save passes through.
 *
 * Three things the copy and the request must never do, and the reason this
 * module owns them:
 *
 * - A field nobody touched records nothing. It reads as not reviewed, it is
 *   left out of the request, and it is never counted in what Save will store.
 *   Agreeing with the classifier is a choice a person makes, not one this
 *   module makes for them by leaving a field alone.
 * - It says a review was saved. It never says a message was completed,
 *   archived or handled, because saving a review changes no mail. Every
 *   state that mentions the mailbox says it is unchanged.
 * - It carries no subject, address or body. A refusal and a failure name a
 *   state and nothing about the message, so the same words may be announced,
 *   shown and logged.
 *
 * Reply expectation and a deadline are not here, and not in the request
 * either. What a person will do about a message is a work decision, not a
 * label the classifier proposed for confirmation.
 */
import type { DeskReviewRequest, RowReview } from '../../../app/desk-review'
import { mailboxCopyId } from '../../../domain/mailbox-copy'
import type { ReviewRefusal, ReviewVerdict } from '../../../domain/review'
import type {
  ClassificationLabels,
  JudgedSubject,
  StoredClassification,
} from '../../../domain/stored-classification'
import { categorySchema, prioritySchema } from '../../../domain/triage'
import type { ReviewField, ReviewFieldOption } from '../../organisms/ReviewPanel/ReviewPanel'
import { categoryLabels, judgedText, priorityLabels } from './classification'
import { reviewGroundsCopy } from './review-grounds'

/** The fields a person may decide here, in the order the panel shows them. */
export const reviewFields = ['category', 'priority'] as const

export type ReviewFieldName = (typeof reviewFields)[number]

export type ReviewCategoryValue = ClassificationLabels['category']
export type ReviewPriorityValue = ClassificationLabels['priority']

/** What a person has picked in this panel so far. An absent field is untouched. */
export type ReviewChoices = Readonly<{
  category?: ReviewCategoryValue | undefined
  priority?: ReviewPriorityValue | undefined
}>

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

/** The label the classifier advised for one field. */
const adviceFor = (field: ReviewFieldName, labels: ClassificationLabels) =>
  field === 'category' ? labels.category : labels.priority

/** What a person already decided about one field, where anyone has. */
const storedValue = (field: ReviewFieldName, saved: RowReview | undefined) =>
  field === 'category' ? saved?.labels.category : saved?.labels.priority

/** Who decided a field this panel recorded but has not seen read back yet. */
const notReadBack = 'You, on this computer. Not read back from the store yet.'

/**
 * The decision that holds for one field: one this panel recorded that no
 * reading has carried back yet, or else the one the reading gave.
 *
 * A recorded decision comes first, and it has to: the caller drops everything
 * it recorded the moment a reading brings another answer for the row, so
 * anything still held here was recorded against this very reading and is
 * therefore later than it. Reading the other way round would leave a field
 * somebody has just decided again showing the decision they replaced.
 *
 * The store took the decision, so the value is not a guess; who decided it
 * and when are the store's to say, and until a reading says so this names
 * only where the decision came from. A field nobody decided has none of this.
 */
function decidedIn(
  field: ReviewFieldName,
  saved: RowReview | undefined,
  recorded: readonly ReviewedField[] = [],
): Readonly<{ value: string; decision: 'confirmed' | 'corrected'; by: string }> | undefined {
  const own = recorded.find((one) => one.field === field)
  if (own !== undefined) return { value: own.value, decision: own.decision, by: notReadBack }
  const value = storedValue(field, saved)
  const decision = saved?.fields[field]
  return value === undefined || decision === undefined
    ? undefined
    : {
        value,
        decision: decision.decision,
        by: `${decision.reviewer}, ${judgedText(decision.reviewedAt)}`,
      }
}

/**
 * What this panel has recorded, with one save's decisions taken up.
 *
 * A field decided twice without a reading in between keeps the later
 * decision only: the store holds both, and the one that holds for the row is
 * the last one it took, not the first this panel happened to send.
 */
export const recordedWith = (
  current: readonly ReviewedField[],
  decided: readonly ReviewedField[],
): readonly ReviewedField[] => [
  ...current.filter((one) => !decided.some((next) => next.field === one.field)),
  ...decided,
]

/** The value that holds for one field, whoever decided it. */
export const decidedValue = (
  field: ReviewFieldName,
  saved: RowReview | undefined,
  recorded: readonly ReviewedField[] = [],
) => decidedIn(field, saved, recorded)?.value

/** How one field's values read, in rubric order. */
const valueLabels = (field: ReviewFieldName): Readonly<Record<string, string>> =>
  field === 'category' ? categoryLabels : priorityLabels

/** How the label the classifier advised for one field reads. */
export const adviceLabelFor = (field: ReviewFieldName, labels: ClassificationLabels) => {
  const advised = adviceFor(field, labels)
  return valueLabels(field)[advised] ?? advised
}

/** How one field's name reads in the panel. */
export const fieldLabelFor = (field: ReviewFieldName) => fieldLabels[field]

/** The values one field offers, in rubric order. */
const valuesOf = (field: ReviewFieldName): readonly string[] =>
  field === 'category' ? categorySchema.options : prioritySchema.options

/** How one field's name reads in the panel. */
const fieldLabels = { category: 'Category', priority: 'Priority' } as const

/**
 * What choosing a value amounts to for one field: `confirmed` where it is the
 * label the classifier advised, `corrected` otherwise. Choosing the advised
 * value is how a person says they agree with it, and it is the only way one is
 * recorded: nothing here confirms a field its reviewer left alone.
 */
const decisionFor = (chosen: string, advised: string) =>
  chosen === advised ? ('confirmed' as const) : ('corrected' as const)

/**
 * Whether one field holds a choice that the store does not already hold.
 *
 * An untouched field never does. A field whose choice is the value already
 * stored for it does not either: recording it again would append a second
 * review that decided exactly what the first one did.
 */
export const isPending = (
  field: ReviewFieldName,
  choices: ReviewChoices,
  saved: RowReview | undefined,
  recorded: readonly ReviewedField[] = [],
) => {
  const chosen = choices[field]
  return chosen !== undefined && chosen !== decidedValue(field, saved, recorded)
}

/**
 * The same choices with one field forgotten, so it reads as untouched again
 * and records nothing. Undoing a choice is how a person takes a field back to
 * unreviewed without having to decide it after all.
 */
export const without = (choices: ReviewChoices, field: ReviewFieldName): ReviewChoices =>
  field === 'category' ? { ...choices, category: undefined } : { ...choices, priority: undefined }

/** Every field one Save would record, in the panel's order. */
export const pendingFields = (
  choices: ReviewChoices,
  saved: RowReview | undefined,
  recorded: readonly ReviewedField[] = [],
): readonly ReviewFieldName[] =>
  reviewFields.filter((field) => isPending(field, choices, saved, recorded))

/** What one chosen value amounts to: confirming the advice, or correcting it. */
const decisionOf = <Value extends string>(chosen: Value, advised: Value) =>
  chosen === advised
    ? ({ decision: 'confirmed' } as const)
    : ({ decision: 'corrected', value: chosen } as const)

/**
 * The verdict one Save would carry: a decision for every pending field, and
 * nothing at all for the others. A field left out of a verdict is a field this
 * review says nothing about, which is exactly what an untouched one means.
 */
export function verdictFor(
  reviewable: Reviewable,
  choices: ReviewChoices,
  saved: RowReview | undefined,
  recorded: readonly ReviewedField[] = [],
): ReviewVerdict {
  const { labels } = reviewable
  const pending = pendingFields(choices, saved, recorded)
  const chosen = <Field extends ReviewFieldName>(field: Field) =>
    pending.includes(field) ? choices[field] : undefined
  const category = chosen('category')
  const priority = chosen('priority')
  return {
    ...(category !== undefined && { category: decisionOf(category, labels.category) }),
    ...(priority !== undefined && { priority: decisionOf(priority, labels.priority) }),
  }
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
 * the same value is a confirmation against one judgment and a correction
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
    saved?.fields.category?.decision ?? null,
    saved?.fields.priority?.decision ?? null,
    saved?.labels.category ?? null,
    saved?.labels.priority ?? null,
    saved?.reviewedAt ?? null,
  ])

/** The request for one save of `reviewable`, naming the version shown. */
export const reviewRequest = (
  reviewable: Reviewable,
  choices: ReviewChoices,
  saved: RowReview | undefined,
  recorded: readonly ReviewedField[] = [],
): Omit<DeskReviewRequest, 'requestId'> => ({
  classification: reviewable.subject,
  verdict: verdictFor(reviewable, choices, saved, recorded),
})

/** One field a review decided: which field, the value, and how. */
export type ReviewedField = Readonly<{
  field: ReviewFieldName
  value: string
  decision: 'confirmed' | 'corrected'
}>

/**
 * What one request decided, field by field, against the labels it was judged
 * with. Empty where it decided nothing, which the contract refuses, so a
 * request recovered from storage that this panel cannot describe is visible
 * as such rather than reported as a decision.
 */
export function decisionsIn(
  verdict: ReviewVerdict,
  labels: ClassificationLabels,
): readonly ReviewedField[] {
  return reviewFields.flatMap((field): ReviewedField[] => {
    const decided = verdict[field]
    if (decided === undefined) return []
    const value = decided.decision === 'corrected' ? decided.value : adviceFor(field, labels)
    return [{ field, value, decision: decided.decision }]
  })
}

/**
 * Every decision that holds for this version, field by field and in the
 * panel's order: what a reading carried, and what this panel recorded over
 * it. A field nothing decided is absent, so nothing here reads as decided
 * that nobody decided.
 */
export const decidedFields = (
  saved: RowReview | undefined,
  recorded: readonly ReviewedField[] = [],
): readonly ReviewedField[] =>
  reviewFields.flatMap((field): ReviewedField[] => {
    const held = decidedIn(field, saved, recorded)
    return held === undefined ? [] : [{ field, value: held.value, decision: held.decision }]
  })

/**
 * Where one save has got to:
 * - `choosing`: no field holds a decision to save.
 * - `unsaved`: `fields` fields are chosen and not yet saved.
 * - `saving`: the request is on its way.
 * - `saved`: it was recorded, and `decided` says what it decided.
 * - `refused`: the store would not take it, and said why.
 * - `failed`: the server answered that nothing was stored.
 * - `unknown`: the answer was lost, so the store must be checked before retry.
 */
export type ReviewState =
  | Readonly<{ status: 'choosing' }>
  | Readonly<{ status: 'unsaved'; fields: number }>
  | Readonly<{ status: 'saving' }>
  | Readonly<{
      status: 'saved'
      /** What this save recorded, or what the store holds where none is on its way. */
      decided: readonly ReviewedField[]
      /** The fields nobody has decided at all, this save and the store together. */
      undecided: readonly ReviewFieldName[]
    }>
  | Readonly<{ status: 'refused'; reason: ReviewRefusal }>
  | Readonly<{ status: 'failed' }>
  | Readonly<{ status: 'unknown' }>

/** Result copy beside the save button: a line, and a second one under it. */
export type ReviewResult = Readonly<{ title: string; detail: string }>

const unchanged = 'Your mailbox is unchanged.'

const counted = (fields: number) => `${String(fields)} ${fields === 1 ? 'field' : 'fields'}`

/** What Save says it will store, so nobody presses it to find out. */
export const saveLabelFor = (fields: number) =>
  fields === 0 ? 'Save review' : `Save ${counted(fields)}`

/**
 * Whether Save is offered. It records the fields that hold a decision, so
 * nothing to record means nothing to press, and it is never offered twice
 * while one save is on its way.
 *
 * An unknown outcome is the exception. That button checks the store for a
 * save whose answer was lost, so it stays reachable however the decisions
 * stored for the row change underneath it: a reading that happens to hold
 * what was chosen must not leave the uncertain save with no way to settle it.
 */
export const saveIsOffered = (state: ReviewState, pending: number, unsettled: boolean) =>
  state.status === 'unknown' ? unsettled : state.status !== 'saving' && pending > 0

const waiting = {
  choosing: {
    title: 'Nothing decided yet',
    detail: `Choose a value for a field, or choose the one marked as the model's advice to confirm it. A field you leave alone stays unreviewed. ${unchanged}`,
  },
  saving: { title: 'Saving review…', detail: `Nothing is being sent to your mail. ${unchanged}` },
} as const satisfies Record<'choosing' | 'saving', ReviewResult>

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
  request_conflict: {
    title: 'Not saved',
    detail:
      'This save request was already used for another decision. Refresh before reviewing again.',
  },
} as const satisfies Record<ReviewRefusal, ReviewResult>

const failure: ReviewResult = {
  title: 'Not saved',
  detail: `The review could not be stored, so nothing was recorded. ${unchanged} Try again.`,
}

const unknown: ReviewResult = {
  title: 'Save outcome unknown',
  detail:
    'The connection lost the answer. The review may have been saved. Check its result or retry this save safely. Your mailbox is unchanged.',
}

/** How one field's decision reads once it is stored. */
const decidedText = ({ field, value, decision }: ReviewedField) => {
  const name = fieldLabels[field]
  const reads = valueLabels(field)[value] ?? value
  return decision === 'confirmed' ? `${name} confirmed as ${reads}` : `${name} set to ${reads}`
}

/**
 * The fields nobody has decided, given every decision that holds for the row.
 * A field somebody decided in an earlier save is not one of them, so a save
 * of one field never reports the other as untouched when it is not.
 */
export const undecidedFields = (decided: readonly ReviewedField[]): readonly ReviewFieldName[] =>
  reviewFields.filter((field) => !decided.some((one) => one.field === field))

/** What is still the classifier's after a save, so nothing reads as reviewed. */
const untouchedText = (left: readonly ReviewFieldName[]) => {
  if (left.length === 0) return ''
  const names = left.map((field) => fieldLabels[field].toLowerCase()).join(' and ')
  return ` The ${names} ${left.length === 1 ? 'stays' : 'stay'} unreviewed, as the model had ${left.length === 1 ? 'it' : 'them'}.`
}

/** What a recorded review says it did, without ever saying the mail moved. */
function recorded(state: Extract<ReviewState, { status: 'saved' }>): ReviewResult {
  const decided = state.decided.map(decidedText).join('. ')
  return {
    title: 'Review saved',
    detail: `${decided}. The model's own advice is kept.${untouchedText(state.undecided)} ${unchanged}`,
  }
}

/** What is chosen and not yet stored, and what saving it would and would not do. */
const unsaved = (fields: number): ReviewResult => ({
  title: `${counted(fields)} ready to save`,
  detail: `Saving records ${fields === 1 ? 'it' : 'them'} on this computer, and decides nothing about any other field. ${unchanged}`,
})

/** The result copy for one state. */
export function reviewResult(state: ReviewState): ReviewResult {
  switch (state.status) {
    case 'saved':
      return recorded(state)
    case 'unsaved':
      return unsaved(state.fields)
    case 'refused':
      return refusals[state.reason]
    case 'failed':
      return failure
    case 'unknown':
      return unknown
    default:
      return waiting[state.status]
  }
}

/**
 * What a polite live region announces once a save settles, or nothing while
 * one is still on its way. A saved review says so and says it is not
 * completed, so nobody hears a mailbox action in it.
 */
export function reviewAnnouncement(state: ReviewState): string {
  if (state.status === 'choosing' || state.status === 'unsaved' || state.status === 'saving') {
    return ''
  }
  const { title, detail } = reviewResult(state)
  return state.status === 'saved' ? `${title}. ${detail} Not completed yet.` : `${title}. ${detail}`
}

/** The options one field offers, with the classifier's advice marked as such. */
export function optionsFor(
  field: ReviewFieldName,
  labels: ClassificationLabels,
): readonly ReviewFieldOption[] {
  const advised = adviceFor(field, labels)
  const reads = valueLabels(field)
  return valuesOf(field).map((value) => ({
    value,
    label: reads[value] ?? value,
    ...(value === advised && { note: "The model's advice" }),
  }))
}

/**
 * What one field's row amounts to now, in its own words.
 *
 * Four things it may say, and each is a different fact about the field: a
 * person decided it and that is stored; a person has chosen something that is
 * not stored yet; they chose what is already stored, so there is nothing to
 * record; or nobody has decided it at all. Nothing reads as a decision that
 * was not made.
 */
export function fieldStateFor(
  field: ReviewFieldName,
  labels: ClassificationLabels,
  choices: ReviewChoices,
  saved: RowReview | undefined,
  recorded: readonly ReviewedField[] = [],
): ReviewField['state'] {
  const chosen = choices[field]
  const held = decidedIn(field, saved, recorded)
  if (chosen !== undefined && chosen !== held?.value) {
    return pendingState(field, labels, chosen)
  }
  if (held === undefined) return { label: 'Not reviewed', tone: 'none' }
  const value = valueLabels(field)[held.value] ?? held.value
  return {
    label: held.decision === 'confirmed' ? `Confirmed as ${value}` : `Set to ${value}`,
    tone: 'saved',
  }
}

/** What a field says while it holds a choice the store does not have yet. */
function pendingState(
  field: ReviewFieldName,
  labels: ClassificationLabels,
  chosen: string,
): ReviewField['state'] {
  const value = valueLabels(field)[chosen] ?? chosen
  return {
    label:
      decisionFor(chosen, adviceFor(field, labels)) === 'confirmed'
        ? `Confirming the model's advice, ${value}. Not saved yet.`
        : `Changing to ${value}. Not saved yet.`,
    tone: 'pending',
  }
}

/** Who decided one field and when, or that nobody has. */
export const decidedByFor = (
  field: ReviewFieldName,
  saved: RowReview | undefined,
  recorded: readonly ReviewedField[] = [],
) => decidedIn(field, saved, recorded)?.by ?? 'Nobody. The model decided this.'

/** One line under the fields, naming what this panel never decides. */
export const outOfScopeNote =
  'This panel decides the category and the priority only. Whether a reply is expected, and by when, is not confirmed here.'

/**
 * Everything the panel says about one reviewable classification, apart from
 * its fields and the state of one save.
 *
 * Why a person was asked comes from the grounds the run recorded, one line
 * each, so a low category score, a mail read as a possible scam and a record
 * that names no grounds at all each read as what they are. See
 * `review-grounds.ts`, which owns that copy and keeps the model's scores,
 * policy's decision and a person's review apart.
 */
export function reviewPanelCopy(labels: ClassificationLabels) {
  const unsure = labels.review === 'needs_review'
  const { lead, grounds } = reviewGroundsCopy(labels)
  return {
    title: unsure ? 'Needs review' : 'Review this triage',
    summary:
      'Compare what the model advised with what you decide, field by field. This records nothing in mail.',
    scoreLabel: 'Model score',
    score: labels.confidence * 100,
    reasonTitle: 'Why review?',
    reason: lead,
    reasons: grounds,
    keptNote: "The model's own advice is kept whatever you decide.",
    fieldsTitle: "The model's advice and your decision",
    fieldsHint:
      "Choose the value marked as the model's advice to confirm it, or another to change it. A field you leave alone stays unreviewed, and saving decides nothing about it.",
    cells: { advice: 'Model advises', decision: 'Your decision', decidedBy: 'Decided by' },
    outOfScope: outOfScopeNote,
    undoLabel: 'Undo',
  } as const
}
