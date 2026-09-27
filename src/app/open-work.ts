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
 * - `complete`: both views read the mailbox to the end, so a copy neither
 *   listed is not in its Inbox.
 * - `bounded`: some view may have been cut, or was not read at all.
 * - `unreadable`: a view could not read the mailbox.
 * - `absent`: the reading holds no such mailbox.
 */
export type MailboxReachOf = (mailboxId: string) => 'complete' | 'bounded' | 'unreadable' | 'absent'

type CoverageViews = Pick<InboxCoverage, 'unread' | 'read'>

const resultIn = (coverage: CoverageViews, view: 'unread' | 'read', mailboxId: string) =>
  coverage[view].mailboxes.find(({ id }) => id === mailboxId)?.result

/**
 * What the Inbox Zero coverage and the current reading prove about each
 * mailbox. Only a complete result in both the unread and the read Inbox view
 * makes a copy's absence mean anything; a view never scanned is bounded, and
 * a failure in either view makes the mailbox unreadable for this purpose.
 */
export function mailboxReachIn(
  scope: Pick<InboxScope, 'mailboxes' | 'failed'>,
  coverage: CoverageViews | undefined,
): MailboxReachOf {
  const listed = new Set(scope.mailboxes.map(({ id }) => id))
  const failed = new Set(scope.failed.map(({ id }) => id))
  return (mailboxId) => {
    if (!listed.has(mailboxId)) return 'absent'
    if (failed.has(mailboxId)) return 'unreadable'
    if (coverage === undefined) return 'bounded'
    const results = [resultIn(coverage, 'unread', mailboxId), resultIn(coverage, 'read', mailboxId)]
    if (results.includes('failed')) return 'unreadable'
    return results.every((result) => result === 'complete') ? 'complete' : 'bounded'
  }
}
