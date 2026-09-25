import { useRef, useState } from 'react'
import type {
  DeskReviewOutcome,
  DeskReviewReadback,
  DeskReviewRequest,
  RowReview,
} from '../../../app/desk-review'
import { ReviewPanel } from '../../organisms/ReviewPanel/ReviewPanel'
import { categoryLabels } from './classification'
import { beginReview, finishReview } from './review-attempt'
import {
  categoryDecisionIn,
  reviewAnnouncement,
  reviewCategories,
  reviewPanelCopy,
  reviewRequest,
  reviewResult,
  reviewSignature,
  type Reviewable,
  type ReviewCategoryValue,
  type ReviewState,
} from './review'

/** Saves one review. It reports an outcome rather than rejecting. */
export type SaveReview = (request: DeskReviewRequest) => Promise<DeskReviewOutcome>
export type CheckReview = (request: DeskReviewRequest) => Promise<DeskReviewReadback>

type ReviewActionProps = Readonly<{
  /** The classification to confirm or correct, and the version it names. */
  reviewable: Reviewable
  /**
   * What a person already decided about this exact classification, where
   * anyone has. The panel opens on that decision, so a review that was saved
   * earlier is still the one shown after a refresh or on reopening the row.
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
 */
type Held = Readonly<{
  signature: string
  chosen: ReviewCategoryValue | null
  state: ReviewState
  announcement: string
  pending?: Readonly<{
    request: DeskReviewRequest
    chosen: ReviewCategoryValue
    decision: 'confirmed' | 'corrected'
  }>
}>

/**
 * Where the panel starts: on a category decision already stored, or on
 * nothing chosen. A review that decided another field and not the category
 * leaves this panel with nothing chosen, because nobody has decided what it
 * asks about.
 */
function startFrom(signature: string, saved: RowReview | undefined, announcement = ''): Held {
  const decided = saved?.fields.category
  const chosen = saved?.labels.category
  if (decided === undefined || chosen === undefined) {
    return { signature, chosen: null, state: { status: 'choosing' }, announcement }
  }
  return {
    signature,
    chosen,
    state: { status: 'saved', decision: decided.decision, chosen },
    announcement,
  }
}

/** What one outcome leaves behind. A recorded review names what it decided. */
function stateFor(outcome: DeskReviewOutcome, pending: NonNullable<Held['pending']>): ReviewState {
  switch (outcome.status) {
    case 'recorded':
      return { status: 'saved', decision: pending.decision, chosen: pending.chosen }
    case 'refused':
      return { status: 'refused', reason: outcome.reason }
    case 'failed':
      return { status: 'failed' }
    case 'unknown':
      return { status: 'unknown' }
  }
}

/**
 * The selection and the save, with only the latest save counting. Choices
 * stay fixed while a save or its uncertain outcome is being checked.
 *
 * A reading can hand the same open row another version of its classification,
 * or a review stored since, without the row closing and this being built
 * again. When it does, what was chosen was chosen about what was shown
 * before, so the panel starts again from what the store now says rather than
 * letting a later save pair an old choice with the version now named.
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
    held.signature === signature ||
    held.state.status === 'saving' ||
    held.state.status === 'unknown'
      ? held
      : startFrom(signature, saved, held.announcement)
  if (shown !== held) setHeld(shown)
  const latest = useRef(0)
  const settle = (state: ReviewState, original: string) => {
    setHeld((current) => ({
      ...current,
      state,
      // Only what happened here is announced. A review the reading already
      // held is shown, not read out: nothing happened to tell anyone of.
      announcement: reviewAnnouncement(state, original),
    }))
  }
  const choose = (value: ReviewCategoryValue) => {
    if (shown.state.status === 'saving' || shown.state.status === 'unknown') return
    latest.current += 1
    setHeld((current) => ({
      ...current,
      chosen: value,
      state: { status: 'unsaved' },
      announcement: '',
    }))
  }
  const active = (attempt: number) => attempt === latest.current
  const complete = (
    outcome: DeskReviewOutcome,
    pending: NonNullable<Held['pending']>,
    attempt: number,
    original: string,
  ) => {
    if (!active(attempt)) return
    if (outcome.status === 'unknown') {
      settle({ status: 'unknown' }, original)
      return
    }
    finishReview(pending.request)
    onResolved()
    settle(stateFor(outcome, pending), original)
  }
  const verify = (
    pending: NonNullable<Held['pending']>,
    attempt: number,
    original: string,
    retryIfAbsent: boolean,
  ) => {
    void onCheck(pending.request).then(
      (readback) => {
        if (!active(attempt)) return
        if (readback.status === 'recorded' || readback.status === 'refused') {
          complete(readback, pending, attempt, original)
        } else if (readback.status === 'absent' && retryIfAbsent) {
          void onSave(pending.request).then(
            (outcome) => {
              complete(outcome, pending, attempt, original)
            },
            () => {
              complete({ status: 'unknown' }, pending, attempt, original)
            },
          )
        } else {
          settle({ status: 'unknown' }, original)
        }
      },
      () => {
        if (active(attempt)) settle({ status: 'unknown' }, original)
      },
    )
  }
  const save = (original: string) => {
    if (shown.state.status === 'saving') return
    if (shown.state.status === 'unknown') {
      const pending = shown.pending
      if (pending === undefined) return
      verify(pending, latest.current, original, true)
      return
    }
    const { chosen } = shown
    if (chosen === null) return
    const draft = reviewRequest(reviewable, chosen)
    const request = beginReview(draft)
    if (request === null) {
      settle({ status: 'failed' }, original)
      return
    }
    // A save recovered from storage that decided another field is not one
    // this panel can report on, so nothing is sent for it. The stored request
    // stays, so whatever did send it keeps its own id.
    const decided = categoryDecisionIn(request, reviewable.labels)
    if (decided === undefined) {
      settle({ status: 'failed' }, original)
      return
    }
    latest.current += 1
    const attempt = latest.current
    const pending = { request, ...decided }
    if (JSON.stringify(request.verdict) !== JSON.stringify(draft.verdict)) {
      setHeld((current) => ({
        ...current,
        chosen: pending.chosen,
        pending,
        state: { status: 'unknown' },
      }))
      verify(pending, attempt, original, false)
      return
    }
    setHeld((current) => ({
      ...current,
      state: { status: 'saving' },
      announcement: '',
      pending,
    }))
    void onSave(request).then(
      (outcome) => {
        complete(outcome, pending, attempt, original)
        if (outcome.status === 'unknown') verify(pending, attempt, original, false)
      },
      () => {
        complete({ status: 'unknown' }, pending, attempt, original)
        verify(pending, attempt, original, false)
      },
    )
  }
  return { ...shown, choose, save } as const
}

/**
 * The review panel for the open message, with the state of one save.
 *
 * The caller owns the saving itself and passes what a reading listed about
 * the row, so this asks about the exact version that was shown: a save that
 * names a version the store has moved past is refused there and says so
 * here. Choosing the category the model chose confirms it; choosing another
 * corrects the category and keeps the judged priority.
 *
 * A review already stored for that same version is what the panel opens on,
 * so a correction saved earlier is still chosen after a refresh, and a later
 * confirmation replaces it. A reading that brings another version of the row,
 * or a review stored since, makes the panel start again from that, whether or
 * not the row closed in between. Only what happens here is announced.
 *
 * Every state a save passes through is visible and announced: nothing
 * chosen, chosen but unsaved, saving, saved, refused, failed and unknown.
 * None of that copy says a message was completed,
 * because saving a review changes no mail, and none of it names the subject,
 * the address or the body.
 *
 * Give it a new `key` per row, so one message's choice never carries to the
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
  const { chosen, state, announcement, choose, save } = useReview(
    reviewable,
    saved,
    onSave,
    onCheck,
    onResolved,
  )
  const original = categoryLabels[labels.category]
  return (
    <>
      <ReviewPanel
        {...reviewPanelCopy(labels)}
        headingLevel={3}
        expanded={expanded}
        onExpandedChange={setExpanded}
        categories={
          state.status === 'saving' || state.status === 'unknown'
            ? reviewCategories.map((category) => ({ ...category, disabled: true }))
            : reviewCategories
        }
        selectedCategory={chosen}
        onSelectedCategoryChange={choose}
        saveDisabled={state.status === 'saving'}
        saveLabel={state.status === 'unknown' ? 'Check or retry save' : 'Save review'}
        onSave={() => {
          save(original)
        }}
        result={reviewResult(state, original)}
      />
      {/* The panel announces nothing itself, so its caller says what happened. */}
      <p className="workbench__review-status" role="status">
        {announcement}
      </p>
    </>
  )
}
