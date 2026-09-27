/**
 * What the reader says about the local work record for the open message:
 * the store's answer to one save, and what the record already held for this
 * copy when the page read it.
 *
 * Plain functions of plain data, like `handling.ts` beside it. Nothing here
 * records, reads a store or reaches a provider.
 *
 * What the copy must never do, and the reason this module owns it:
 *
 * - Say a decision was saved before the store answered that it was. A lost
 *   answer is unconfirmed, not saved and not failed.
 * - Call "Handled in Spark" done. It is the person's claim, saved locally;
 *   nothing asked Spark and nothing read it back.
 * - Carry a saved decision onto a version it was not made against. A saved
 *   decision the thread has moved past reads as out of date with the work
 *   open, and one this reading cannot place reads as unchecked.
 */
import type { FollowUpKind, FollowUpWork } from '../../../domain/follow-up'
import type { HandlingOutcome } from '../../../domain/handling'
import type { TargetBreak } from '../../../domain/mailbox-action'
import { judgedText } from './classification'

type Tone = 'neutral' | 'review' | 'done' | 'danger'

/**
 * Where one save to the local work record stands:
 * - `off`: this page has nowhere to save work, so a decision is kept while
 *   the message stays open and no longer.
 * - `not_kept`: the outcome adds nothing to the record (Read only).
 * - `saving`, `saved`, `not_saved`, `unconfirmed`: the store's answer, or its
 *   absence, for this one save.
 */
export type WorkSave = Readonly<{
  status: 'off' | 'not_kept' | 'saving' | 'saved' | 'not_saved' | 'unconfirmed'
}>

type SavedView = Readonly<{
  detail: string
  state: Readonly<{ label: string; tone: Tone }>
  tags: readonly string[]
}>

const claim =
  'This is your own claim: nothing asked Spark or read it back, so it is not a confirmed Done.'

const savedCopy: Readonly<Record<WorkSave['status'], SavedView>> = {
  off: {
    detail:
      'Recorded in this app only. The mail stays in your Spark Inbox, and nothing was saved: this decision is kept while the message stays open.',
    state: { label: 'Local work status', tone: 'review' },
    tags: ['Local work status'],
  },
  not_kept: {
    detail:
      'No work is owed, so nothing is added to Open work. The mail stays in your Spark Inbox.',
    state: { label: 'No work owed', tone: 'neutral' },
    tags: ['Local work status'],
  },
  saving: {
    detail: 'Saving to Open work in this app…',
    state: { label: 'Saving', tone: 'review' },
    tags: ['Local work status'],
  },
  saved: {
    detail:
      'Saved to Open work in this app for this exact mailbox copy and version. It stays after you close the app.',
    state: { label: 'Saved here', tone: 'review' },
    tags: ['Saved in Open work'],
  },
  not_saved: {
    detail: 'Not saved: the local work record did not take it. Change the decision to try again.',
    state: { label: 'Not saved', tone: 'danger' },
    tags: ['Not saved'],
  },
  unconfirmed: {
    detail:
      'The save may or may not have reached the local work record. Refresh and check Open work before deciding again.',
    state: { label: 'Save unconfirmed', tone: 'danger' },
    tags: ['Save unconfirmed'],
  },
}

/** What one local outcome's save amounts to, in words. */
export function savedView(
  outcome: Exclude<HandlingOutcome, 'handle_now'>,
  saved: WorkSave,
): SavedView {
  const view = savedCopy[saved.status]
  if (outcome !== 'handled_in_spark' || saved.status !== 'saved') return view
  return {
    detail: `Saved to Open work in this app as completed. ${claim}`,
    state: { label: 'Your claim, saved', tone: 'neutral' },
    tags: ['Saved in Open work', 'Not a confirmed Done'],
  }
}

export const kindLabels = {
  reply_needed: 'Reply needed',
  follow_up_later: 'Follow up later',
  handled_in_spark: 'Handled in Spark',
  reopen: 'Reopened',
} as const satisfies Record<FollowUpKind, string>

const dueFormat = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
})

/** A due date in the reader's own zone, e.g. "Fri 2 Oct". */
export const dueText = (dueAt: string) => dueFormat.format(new Date(dueAt))

const movedOn = {
  newer_message: 'A later message has reached this thread since it was saved.',
  other_thread: 'This copy now belongs to another thread than the one it was saved for.',
} as const satisfies Record<TargetBreak, string>

/** What a saved work readback says, before the reader's own decision replaces it. */
export type StoredView = Readonly<{
  title: string
  detail: string
  state: Readonly<{ label: string; tone: Tone }>
}>

type Decided = Exclude<FollowUpWork, { state: 'undecided' }>

const savedBy = ({ decision }: Decided) =>
  `Saved by ${decision.decidedBy} on ${judgedText(decision.decidedAt)}${
    decision.dueAt === null ? '' : `, due ${dueText(decision.dueAt)}`
  }.`

function storedState(work: Decided): StoredView['state'] {
  if (work.state === 'handled') return { label: 'Your claim', tone: 'neutral' }
  if (work.state === 'lapsed') return { label: 'Out of date', tone: 'danger' }
  if (work.state === 'unobserved') return { label: 'Version not checked', tone: 'review' }
  return { label: 'Open work', tone: 'review' }
}

function storedMeaning(work: Decided): string {
  if (work.state === 'handled') return claim
  if (work.state === 'lapsed') {
    return `${movedOn[work.reason]} The saved decision is about the version before it, so the work is open again: decide again for the version shown now.`
  }
  if (work.state === 'unobserved') {
    return 'This reading names no version for this message, so whether the saved decision still describes it is unknown.'
  }
  return 'It is about this exact mailbox copy and version, and stays open until you decide again.'
}

/**
 * What the local record holds for the open copy, or nothing where nobody
 * decided about it. The latest decision is shown with where it stands now;
 * the history before it stays in the record, untouched.
 */
export function storedView(work: FollowUpWork | undefined): StoredView | null {
  if (work === undefined || work.state === 'undecided') return null
  return {
    title: kindLabels[work.decision.kind],
    detail: `${savedBy(work)} ${storedMeaning(work)}`,
    state: storedState(work),
  }
}
