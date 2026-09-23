import { useRef, useState } from 'react'
import type { DeskReviewOutcome, DeskReviewRequest } from '../../../app/desk-review'
import { ReviewPanel } from '../../organisms/ReviewPanel/ReviewPanel'
import { categoryLabels } from './classification'
import {
  reviewAnnouncement,
  reviewCategories,
  reviewPanelCopy,
  reviewRequest,
  reviewResult,
  type Reviewable,
  type ReviewCategoryValue,
  type ReviewState,
} from './review'

/** Saves one review. It reports an outcome rather than rejecting. */
export type SaveReview = (request: DeskReviewRequest) => Promise<DeskReviewOutcome>

type ReviewActionProps = Readonly<{
  /** The classification to confirm or correct, and the version it names. */
  reviewable: Reviewable
  onSave: SaveReview
}>

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
 */
function useReview(reviewable: Reviewable, onSave: SaveReview) {
  const [chosen, setChosen] = useState<ReviewCategoryValue | null>(null)
  const [state, setState] = useState<ReviewState>({ status: 'choosing' })
  const latest = useRef(0)
  const choose = (value: ReviewCategoryValue) => {
    latest.current += 1
    setChosen(value)
    setState({ status: 'unsaved' })
  }
  const save = () => {
    if (chosen === null) return
    latest.current += 1
    const attempt = latest.current
    const request = reviewRequest(reviewable, chosen)
    setState({ status: 'saving' })
    void onSave(request).then(
      (outcome) => {
        if (attempt === latest.current) setState(stateFor(outcome, request, chosen))
      },
      () => {
        if (attempt === latest.current) setState({ status: 'failed' })
      },
    )
  }
  return { chosen, state, choose, save } as const
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
 * Every state a save passes through is visible and announced: nothing
 * chosen, chosen but unsaved, saving, saved, refused as no longer current,
 * and not stored at all. None of that copy says a message was completed,
 * because saving a review changes no mail, and none of it names the subject,
 * the address or the body.
 *
 * Give it a new `key` per row, so one message's choice never carries to the
 * next.
 */
export function ReviewAction({ reviewable, onSave }: ReviewActionProps) {
  const { labels } = reviewable
  const [expanded, setExpanded] = useState(labels.review === 'needs_review')
  const { chosen, state, choose, save } = useReview(reviewable, onSave)
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
        onSave={save}
        result={reviewResult(state, original)}
      />
      {/* The panel announces nothing itself, so its caller says what happened. */}
      <p className="workbench__review-status" role="status">
        {reviewAnnouncement(state, original)}
      </p>
    </>
  )
}
