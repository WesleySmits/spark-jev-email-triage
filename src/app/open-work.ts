/**
 * The recorded work list as the desk takes and gives it.
 *
 * Browser-safe: this module imports no server code, so the page may hold
 * these types and build a request. The server side is `open-work.server.ts`,
 * reached only through `open-work.functions.ts`.
 *
 * A request names the decision, the exact mailbox copy and thread version it
 * was made against, an optional date, and one stable Save id. Who decided
 * and when are stamped on the server, as they are for a review: a browser
 * may not name a decider, and a decision is timed by the computer that
 * stores it.
 *
 * Nothing here reaches a provider. "Handled in Spark" is recorded as a
 * person's claim and no Spark command runs for it; the guarded Done path
 * keeps its own approval, receipt and readback.
 */
import { z } from 'zod'
import { followUpKinds, type FollowUpDecision, type FollowUpRefusal } from '../domain/follow-up'
import { actionTargetSchema } from '../domain/mailbox-action'
import type { MailboxCopyRef } from '../domain/mailbox-copy'
import type { InboxCoverage } from './inbox-coverage'
import type { InboxScope } from './live-inbox'

export const workDecisionRequestSchema = z.strictObject({
  /** Stable across transport retries for this Save. */
  requestId: z.uuid(),
  kind: z.enum(followUpKinds),
  /** The copy and thread version shown when the person decided. */
  target: actionTargetSchema,
  /** When the work is owed, where a person named a date. */
  dueAt: z.iso.datetime({ offset: true }).nullable(),
})

export type WorkDecisionRequest = z.infer<typeof workDecisionRequestSchema>

/**
 * What came of one decision:
 * - `recorded`: it was appended to this copy's history.
 * - `refused`: the store would not take it, in a content-free code.
 * - `failed`: the server answered that nothing was stored.
 * - `unknown`: the answer was lost or the commit could not be confirmed.
 *   Resending the same Save id records nothing twice.
 */
export type WorkDecisionOutcome =
  | Readonly<{ status: 'recorded' }>
  | Readonly<{ status: 'refused'; reason: FollowUpRefusal }>
  | Readonly<{ status: 'failed' }>
  | Readonly<{ status: 'unknown' }>

/** One mailbox copy's decisions, latest first, as the store committed them. */
export type RecordedWorkCopy = Readonly<{
  copy: MailboxCopyRef
  decisions: readonly FollowUpDecision[]
}>

/**
 * What the local record holds:
 * - `ready`: every copy anybody decided about, most recently decided first,
 *   and whether a limit may have cut the list.
 * - `absent`: no local store exists yet, so nothing was ever recorded.
 * - `unavailable`: the store could not be read. That is not an empty list.
 */
export type RecordedWork =
  | Readonly<{
      status: 'ready'
      copies: readonly RecordedWorkCopy[]
      bounded: boolean
      /** When the record was read, as an ISO instant. */
      readAt: string
    }>
  | Readonly<{ status: 'absent' }>
  | Readonly<{ status: 'unavailable' }>

/**
 * How far one reading reached into a mailbox, across both Inbox views:
 * - `complete`: the shown view read the mailbox to the end, and the other
 *   view read it to the end and held nothing there, so a copy the shown rows
 *   do not list is not in its Inbox.
 * - `bounded`: some view may have been cut, or was not read at all.
 * - `unreadable`: a view could not read the mailbox.
 * - `absent`: the reading holds no such mailbox.
 */
export type MailboxReachOf = (mailboxId: string) => 'complete' | 'bounded' | 'unreadable' | 'absent'

type CoverageViews = Pick<InboxCoverage, 'unread' | 'read'>

type ViewName = 'unread' | 'read'

/** One view's result for one mailbox, with how many rows it held there. */
const resultIn = (coverage: CoverageViews, view: ViewName, mailboxId: string) =>
  coverage[view].mailboxes.find(({ id }) => id === mailboxId) ?? { result: 'unscanned', loaded: 0 }

/** What the two views' scans prove about one mailbox the reading holds. */
function coveredReach(
  coverage: CoverageViews,
  [shown, other]: readonly [ViewName, ViewName],
  mailboxId: string,
): ReturnType<MailboxReachOf> {
  const here = resultIn(coverage, shown, mailboxId)
  const there = resultIn(coverage, other, mailboxId)
  if (here.result === 'failed' || there.result === 'failed') return 'unreadable'
  const otherEmpty = there.result === 'complete' && there.loaded === 0
  return here.result === 'complete' && otherEmpty ? 'complete' : 'bounded'
}

/**
 * What the Inbox Zero coverage and the shown reading prove about each
 * mailbox.
 *
 * The page holds the shown view's rows only, so a copy's absence from them
 * proves it left the Inbox only where the shown view read that mailbox to the
 * end and the other view read it to the end and found nothing there: a copy
 * in the other view would otherwise read as gone. A view never scanned is
 * bounded, and a failure in either view makes the mailbox unreadable for this
 * purpose. The two views are read one after the other, never at one instant.
 */
export function mailboxReachIn(
  scope: Pick<InboxScope, 'mailboxes' | 'failed' | 'view'>,
  coverage: CoverageViews | undefined,
): MailboxReachOf {
  const listed = new Set(scope.mailboxes.map(({ id }) => id))
  const failed = new Set(scope.failed.map(({ id }) => id))
  const views =
    scope.view === 'unread' ? (['unread', 'read'] as const) : (['read', 'unread'] as const)
  return (mailboxId) => {
    if (!listed.has(mailboxId)) return 'absent'
    if (failed.has(mailboxId)) return 'unreadable'
    return coverage === undefined ? 'bounded' : coveredReach(coverage, views, mailboxId)
  }
}
