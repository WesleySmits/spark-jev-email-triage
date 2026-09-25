import { useRef, useState } from 'react'
import type {
  DeskReviewOutcome,
  DeskReviewReadback,
  DeskReviewRequest,
  RowReview,
} from '../../../app/desk-review'
import { ReviewPanel, type ReviewField } from '../../organisms/ReviewPanel/ReviewPanel'
import { beginReview, finishReview } from './review-attempt'
import {
  adviceLabelFor,
  decidedByFor,
  decidedValue,
  fieldLabelFor,
  decisionsIn,
  fieldStateFor,
  optionsFor,
  pendingFields,
  reviewAnnouncement,
  reviewFields,
  reviewPanelCopy,
  reviewRequest,
  reviewResult,
  reviewSignature,
  saveLabelFor,
  storedDecisions,
  without,
  type ReviewedField,
  type Reviewable,
  type ReviewChoices,
  type ReviewFieldName,
  type ReviewState,
} from './review'

/** Saves one review. It reports an outcome rather than rejecting. */
export type SaveReview = (request: DeskReviewRequest) => Promise<DeskReviewOutcome>
export type CheckReview = (request: DeskReviewRequest) => Promise<DeskReviewReadback>

type ReviewActionProps = Readonly<{
  /** The classification to confirm or correct, and the version it names. */
  reviewable: Reviewable
  /**
   * What a person already decided about this exact classification, field by
   * field, where anyone has. Each field's row opens on its own decision, so a
   * review saved earlier is still the one shown after a refresh or on
   * reopening the row, and a field nobody decided still reads as unreviewed.
   */
  saved?: RowReview | undefined
  onSave: SaveReview
  onCheck: CheckReview
  onResolved: () => void
}>

/**
 * What the panel holds, and what it holds it about. `signature` names the
 * version being reviewed and the review stored for it, so a reading that
 * changes either can be noticed without the row closing.
 *
 * `choices` holds only what a person picked here. A field they never touched
 * is absent from it, and absence is what makes a field unreviewed: nothing in
 * this state can turn into a decision nobody made.
 */
type Held = Readonly<{
  signature: string
  choices: ReviewChoices
  state: ReviewState
  announcement: string
  pending?: Readonly<{ request: DeskReviewRequest; decided: readonly ReviewedField[] }>
}>

/** What the panel says when no field holds a choice: what the store holds. */
const resting = (saved: RowReview | undefined): ReviewState => {
  const decided = storedDecisions(saved)
  return decided.length === 0 ? { status: 'choosing' } : { status: 'saved', decided }
}

/** Where the panel starts: on nothing chosen, over what the store holds. */
const startFrom = (signature: string, saved: RowReview | undefined, announcement = ''): Held => ({
  signature,
  choices: {},
  state: resting(saved),
  announcement,
})

/** What one outcome leaves behind. A recorded review names what it decided. */
function stateFor(outcome: DeskReviewOutcome, pending: NonNullable<Held['pending']>): ReviewState {
  switch (outcome.status) {
    case 'recorded':
      return { status: 'saved', decided: pending.decided }
    case 'refused':
      return { status: 'refused', reason: outcome.reason }
    case 'failed':
      return { status: 'failed' }
    case 'unknown':
      return { status: 'unknown' }
  }
}

/** Whether a save is on its way or its outcome is still being established. */
const settling = (state: ReviewState) => state.status === 'saving' || state.status === 'unknown'

/**
 * The choices and the save, with only the latest save counting. Choices stay
 * fixed while a save or its uncertain outcome is being checked.
 *
 * A reading can hand the same open row another version of its classification,
 * or a review stored since, without the row closing and this being built
 * again. When it does, what was chosen was chosen about what was shown
 * before, so the panel starts again from what the store now says rather than
 * letting a later save pair an old choice with the version now named. That is
 * also what clears the choices once a save is recorded: the store's own answer
 * comes back as `saved`, and every field then reads from it.
 *
 * A save already on its way is left alone: its request went out naming the
 * version that was shown then, the store decides that on its own terms, and
 * the change is taken up once the answer is in. The answer is kept and still
 * announced, so nobody is left wondering what became of what they pressed.
 */
function useReview(
  reviewable: Reviewable,
  saved: RowReview | undefined,
  onSave: SaveReview,
  onCheck: CheckReview,
  onResolved: () => void,
) {
  const signature = reviewSignature(reviewable, saved)
  const [held, setHeld] = useState(() => startFrom(signature, saved))
  const shown =
    held.signature === signature || settling(held.state)
      ? held
      : startFrom(signature, saved, held.announcement)
  if (shown !== held) setHeld(shown)
  const latest = useRef(0)
  const settle = (state: ReviewState, choices?: ReviewChoices) => {
    setHeld((current) => ({
      ...current,
      ...(choices !== undefined && { choices }),
      state,
      // Only what happened here is announced. A review the reading already
      // held is shown, not read out: nothing happened to tell anyone of.
      announcement: reviewAnnouncement(state),
    }))
  }
  /** What the panel says with these choices: what is pending, or what is stored. */
  const stateOf = (choices: ReviewChoices) => {
    const fields = pendingFields(choices, saved).length
    return fields === 0 ? resting(saved) : ({ status: 'unsaved', fields } as const)
  }
  const pick = (choices: ReviewChoices) => {
    if (settling(shown.state)) return
    latest.current += 1
    setHeld((current) => ({ ...current, choices, state: stateOf(choices), announcement: '' }))
  }
  const choose = (field: ReviewFieldName, value: string) => {
    pick({ ...shown.choices, [field]: value })
  }
  const undo = (field: ReviewFieldName) => {
    pick(without(shown.choices, field))
  }
  const active = (attempt: number) => attempt === latest.current
  const complete = (
    outcome: DeskReviewOutcome,
    pending: NonNullable<Held['pending']>,
    attempt: number,
  ) => {
    if (!active(attempt)) return
    if (outcome.status === 'unknown') {
      settle({ status: 'unknown' })
      return
    }
    finishReview(pending.request)
    onResolved()
    const next = stateFor(outcome, pending)
    // What was recorded is no longer pending, whatever a later reading says
    // about it, so nothing here asks to be saved a second time. Every field
    // then reads from the store again, through `saved`.
    settle(next, next.status === 'saved' ? {} : undefined)
  }
  const verify = (
    pending: NonNullable<Held['pending']>,
    attempt: number,
    retryIfAbsent: boolean,
  ) => {
    void onCheck(pending.request).then(
      (readback) => {
        if (!active(attempt)) return
        if (readback.status === 'recorded' || readback.status === 'refused') {
          complete(readback, pending, attempt)
        } else if (readback.status === 'absent' && retryIfAbsent) {
          void onSave(pending.request).then(
            (outcome) => {
              complete(outcome, pending, attempt)
            },
            () => {
              complete({ status: 'unknown' }, pending, attempt)
            },
          )
        } else {
          settle({ status: 'unknown' })
        }
      },
      () => {
        if (active(attempt)) settle({ status: 'unknown' })
      },
    )
  }
  const save = () => {
    if (shown.state.status === 'saving') return
    if (shown.state.status === 'unknown') {
      const pending = shown.pending
      if (pending === undefined) return
      verify(pending, latest.current, true)
      return
    }
    if (pendingFields(shown.choices, saved).length === 0) return
    const draft = reviewRequest(reviewable, shown.choices, saved)
    const request = beginReview(draft)
    if (request === null) {
      settle({ status: 'failed' })
      return
    }
    // A request recovered from storage may decide other fields than the draft.
    // What it decided is what the panel reports, so nothing is claimed for a
    // save this panel did not compose.
    const decided = decisionsIn(request.verdict, reviewable.labels)
    if (decided.length === 0) {
      settle({ status: 'failed' })
      return
    }
    latest.current += 1
    const attempt = latest.current
    const pending = { request, decided }
    if (JSON.stringify(request.verdict) !== JSON.stringify(draft.verdict)) {
      setHeld((current) => ({ ...current, pending, state: { status: 'unknown' } }))
      verify(pending, attempt, false)
      return
    }
    setHeld((current) => ({ ...current, state: { status: 'saving' }, announcement: '', pending }))
    void onSave(request).then(
      (outcome) => {
        complete(outcome, pending, attempt)
        if (outcome.status === 'unknown') verify(pending, attempt, false)
      },
      () => {
        complete({ status: 'unknown' }, pending, attempt)
        verify(pending, attempt, false)
      },
    )
  }
  return { ...shown, choose, undo, save } as const
}

type FieldsOptions = Readonly<{
  reviewable: Reviewable
  saved: RowReview | undefined
  choices: ReviewChoices
  undoLabel: string
  disabled: boolean
  choose: (field: ReviewFieldName, value: string) => void
  undo: (field: ReviewFieldName) => void
}>

/**
 * One row per reviewable field. Each row shows the label the classifier
 * advised, the value a person decided where anyone did, and who decided it.
 * A field with no choice and no stored decision shows neither: its options are
 * all unchecked and its own words say it is unreviewed.
 */
function fieldsFor({ reviewable, saved, choices, ...rest }: FieldsOptions): readonly ReviewField[] {
  const { labels } = reviewable
  const pending = pendingFields(choices, saved)
  return reviewFields.map((field): ReviewField => {
    return {
      name: field,
      label: fieldLabelFor(field),
      advice: adviceLabelFor(field, labels),
      ...(field === 'priority' &&
        labels.priorityUncertain && { adviceNote: 'The model was not sure of this.' }),
      options: optionsFor(field, labels),
      chosen: choices[field] ?? decidedValue(field, saved) ?? null,
      onChoose: (value) => {
        rest.choose(field, value)
      },
      state: fieldStateFor(field, labels, choices, saved),
      decidedBy: decidedByFor(field, saved),
      ...(pending.includes(field) && {
        onUndo: () => {
          rest.undo(field)
        },
      }),
      undoLabel: rest.undoLabel,
      disabled: rest.disabled,
    }
  })
}

/**
 * The review panel for the open message, with the state of one save.
 *
 * The caller owns the saving itself and passes what a reading listed about
 * the row, so this asks about the exact version that was shown: a save that
 * names a version the store has moved past is refused there and says so here.
 *
 * Each field is its own decision. Choosing the value marked as the model's
 * advice confirms that field; choosing another changes it; leaving it alone
 * decides nothing about it, and Save says how many fields it would record
 * before anyone presses it. A review already stored for this version is what
 * each row opens on, so a decision saved earlier is still shown after a
 * refresh, and a later one replaces it field by field.
 *
 * Every state a save passes through is visible and announced: nothing chosen,
 * chosen but unsaved, saving, saved, refused, failed and unknown. None of that
 * copy says a message was completed, because saving a review changes no mail,
 * and none of it names the subject, the address or the body.
 *
 * Give it a new `key` per row, so one message's choices never carry to the
 * next.
 */
export function ReviewAction({
  reviewable,
  saved,
  onSave,
  onCheck,
  onResolved,
}: ReviewActionProps) {
  const { labels } = reviewable
  // Open where the model asked for a person, and where one has answered.
  const [expanded, setExpanded] = useState(labels.review === 'needs_review' || saved !== undefined)
  const { choices, state, announcement, choose, undo, save } = useReview(
    reviewable,
    saved,
    onSave,
    onCheck,
    onResolved,
  )
  const { undoLabel, ...copy } = reviewPanelCopy(labels)
  const pending = pendingFields(choices, saved).length
  return (
    <>
      <ReviewPanel
        {...copy}
        headingLevel={3}
        expanded={expanded}
        onExpandedChange={setExpanded}
        fields={fieldsFor({
          reviewable,
          saved,
          choices,
          undoLabel,
          disabled: settling(state),
          choose,
          undo,
        })}
        saveDisabled={pending === 0 || state.status === 'saving'}
        saveLabel={state.status === 'unknown' ? 'Check or retry save' : saveLabelFor(pending)}
        onSave={save}
        result={reviewResult(state)}
      />
      {/* The panel announces nothing itself, so its caller says what happened. */}
      <p className="workbench__review-status" role="status">
        {announcement}
      </p>
    </>
  )
}
