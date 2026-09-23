import { useRef, useState } from 'react'
import type { DeskReviewOutcome, DeskReviewRequest, RowReview } from '../../../app/desk-review'
import { ReviewPanel } from '../../organisms/ReviewPanel/ReviewPanel'
import { categoryLabels } from './classification'
import {
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
}>

/** Where the panel starts: on a review already stored, or on nothing chosen. */
function startFrom(signature: string, saved: RowReview | undefined, announcement = ''): Held {
  if (saved === undefined) {
    return { signature, chosen: null, state: { status: 'choosing' }, announcement }
  }
  const chosen = saved.labels.category
  return {
    signature,
    chosen,
    state: { status: 'saved', decision: saved.decision, chosen },
    announcement,
  }
}

/** What one outcome leaves behind. A recorded review names what it decided. */
function stateFor(
  outcome: DeskReviewOutcome,
  request: DeskReviewRequest,
  chosen: ReviewCategoryValue,
): ReviewState {
  switch (outcome.status) {
    case 'recorded':
      return { status: 'saved', decision: request.verdict.decision, chosen }
    case 'refused':
      return { status: 'refused', reason: outcome.reason }
    case 'failed':
      return { status: 'failed' }
  }
}

/**
 * The selection and the save, with only the latest save counting. A person
 * who chooses again while one is on its way is answered about that choice,
 * not about the one they left behind.
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
function useReview(reviewable: Reviewable, saved: RowReview | undefined, onSave: SaveReview) {
  const signature = reviewSignature(reviewable, saved)
  const [held, setHeld] = useState(() => startFrom(signature, saved))
  const shown =
    held.signature === signature || held.state.status === 'saving'
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
    latest.current += 1
    setHeld((current) => ({
      ...current,
      chosen: value,
      state: { status: 'unsaved' },
      announcement: '',
    }))
  }
  const save = (original: string) => {
    const { chosen } = shown
    if (chosen === null) return
    latest.current += 1
    const attempt = latest.current
    const request = reviewRequest(reviewable, chosen)
    setHeld((current) => ({ ...current, state: { status: 'saving' }, announcement: '' }))
    void onSave(request).then(
      (outcome) => {
        if (attempt === latest.current) settle(stateFor(outcome, request, chosen), original)
      },
      () => {
        if (attempt === latest.current) settle({ status: 'failed' }, original)
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
 * chosen, chosen but unsaved, saving, saved, refused as no longer current,
 * and not stored at all. None of that copy says a message was completed,
 * because saving a review changes no mail, and none of it names the subject,
 * the address or the body.
 *
 * Give it a new `key` per row, so one message's choice never carries to the
 * next.
 */
export function ReviewAction({ reviewable, saved, onSave }: ReviewActionProps) {
  const { labels } = reviewable
  // Open where the model asked for a person, and where one has answered.
  const [expanded, setExpanded] = useState(labels.review === 'needs_review' || saved !== undefined)
  const { chosen, state, announcement, choose, save } = useReview(reviewable, saved, onSave)
  const original = categoryLabels[labels.category]
  return (
    <>
      <ReviewPanel
        {...reviewPanelCopy(labels)}
        headingLevel={3}
        expanded={expanded}
        onExpandedChange={setExpanded}
        categories={reviewCategories}
        selectedCategory={chosen}
        onSelectedCategoryChange={choose}
        saveDisabled={state.status === 'saving'}
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
