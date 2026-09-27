/**
 * The work this application still owes, read from the decisions it recorded
 * and from what one reading of Spark proves about each copy those decisions
 * name.
 *
 * `follow-up.ts` answers where the work on one copy stands. This module is
 * the list of them: which copies still owe work, which of those are past the
 * date somebody named, which were closed, and — separately from all three —
 * what could not be checked and what plainly disagrees with the record.
 *
 * Invariants:
 * - Every figure here is counted from decisions this application recorded.
 *   None of them is a Spark Inbox count, an unread count or a claim about
 *   mail nobody decided about, and nothing here adds a copy the record does
 *   not name.
 * - Whether a copy is still in the Spark Inbox is evidence, not an
 *   assumption. A reading that listed the copy proves it is there; a reading
 *   that read the copy's mailbox completely in every Inbox view and did not
 *   list it proves it is not; anything else is `unknown`, including a bounded
 *   reading, a mailbox that failed and a mailbox this reading never held.
 *   Absence from a bounded page depth proves nothing and is never read as
 *   Done.
 * - A decision is never carried onto a version nobody decided about.
 *   `followUpWork` decides that, so version drift is reported here as the
 *   conflict it is: the work is open again and the old decision is shown as
 *   out of date rather than quietly made current.
 * - "Handled in Spark" is one person's claim. A copy still listed in the
 *   Inbox after such a claim is a conflict this module states; it is never
 *   evidence that the claim was wrong, and nothing here upgrades any claim to
 *   a confirmation. Only the guarded Done path's provider readback confirms
 *   anything, and it does not pass through here.
 * - Each mailbox copy is its own item. One delivery to an address and to an
 *   alias owes work twice and appears twice, even though Spark would act on
 *   the provider message id they share.
 * - Nothing here holds a subject, an address or a body: ids, instants, a
 *   local account name and content-free codes only.
 */
import { type FollowUpDecision, type FollowUpWork, followUpWork } from './follow-up'
import type { TargetObservation } from './mailbox-action'
import { mailboxCopyId, type MailboxCopyRef } from './mailbox-copy'

/** The Inbox readings this application makes: unread mail, and read mail. */
export type InboxPlace = 'unread' | 'read'

/**
 * What one reading proves about where a copy sits in the Spark Inbox:
 * - `listed`: the reading listed this exact copy in that Inbox view, which
 *   is proof it was in the Inbox when the reading ran.
 * - `read_completely`: every Inbox view read this copy's mailbox to the end
 *   and none of them listed the copy. That is proof it is not in the Inbox.
 * - `bounded`: the mailbox was read, but a bound may have cut the reading, so
 *   not finding the copy proves nothing at all.
 * - `unreadable`: the copy's mailbox could not be read in this reading.
 * - `absent`: this reading holds no such mailbox, so it says nothing about it.
 */
export type InboxEvidence =
  | Readonly<{ reach: 'listed'; view: InboxPlace }>
  | Readonly<{ reach: 'read_completely' | 'bounded' | 'unreadable' | 'absent' }>

/**
 * Where a copy stands in the Spark Inbox, as evidence allows:
 * - `in_inbox`: a reading listed it, in the view named.
 * - `not_in_inbox`: every Inbox view read its mailbox completely without it.
 * - `unknown`: nothing read proves either, and the reason says which limit
 *   stopped it. An unknown is never shown, counted or treated as one of the
 *   other two.
 */
export type InboxStanding =
  | Readonly<{ status: 'in_inbox'; view: InboxPlace }>
  | Readonly<{ status: 'not_in_inbox' }>
  | Readonly<{
      status: 'unknown'
      reason: 'bounded_reading' | 'mailbox_unreadable' | 'mailbox_absent'
    }>

const unknownFor = {
  bounded: 'bounded_reading',
  unreadable: 'mailbox_unreadable',
  absent: 'mailbox_absent',
} as const

/** Where one copy stands in the Inbox, given what a reading proved about it. */
export function inboxStanding(evidence: InboxEvidence): InboxStanding {
  if (evidence.reach === 'listed') return { status: 'in_inbox', view: evidence.view }
  if (evidence.reach === 'read_completely') return { status: 'not_in_inbox' }
  return { status: 'unknown', reason: unknownFor[evidence.reach] }
}

/**
 * Something the record and the reading do not agree about, stated rather than
 * resolved:
 * - `version_drift`: the latest decision names a version the thread has moved
 *   past. The work is open again and that decision describes the version
 *   before it, never the one that replaced it.
 * - `left_inbox`: work is owed on a copy a complete reading proves is no
 *   longer in the Inbox. Something happened to that mail outside this
 *   application, and the work still reads as owed until somebody decides.
 * - `handled_still_in_inbox`: a person said they finished this in Spark and
 *   the reading still lists it in the Inbox. Their claim stands as a claim;
 *   nothing here overrides it, and nothing here calls it confirmed either.
 * - `unverified`: the reading could not say where this copy is, or which
 *   version it holds, so the record cannot be checked against it at all.
 */
export type WorkConflict = 'version_drift' | 'left_inbox' | 'handled_still_in_inbox' | 'unverified'

/**
 * Where one item belongs in the list:
 * - `overdue`: work is owed and the date somebody named has passed.
 * - `open`: work is owed, by the date named or by none.
 * - `unknown`: decisions exist and the reading names no version for the copy,
 *   so which of them describes it now cannot be said.
 * - `completed`: the latest decision closed the work. It is a person's own
 *   claim unless the guarded Done path confirmed one, which it records
 *   elsewhere.
 */
export type OpenWorkGroup = 'overdue' | 'open' | 'unknown' | 'completed'

/** One mailbox copy's recorded work, and what a reading says about the copy. */
export type WorkCopyRecord = Readonly<{
  copy: MailboxCopyRef
  /** Every decision recorded for it, latest first, in the order the store committed. */
  decisions: readonly FollowUpDecision[]
  evidence: InboxEvidence
  /** What the reading says about this copy's thread version, where it says anything. */
  observation?: TargetObservation | undefined
}>

/** One copy's recorded work as the list shows it. */
export type OpenWorkItem = Readonly<{
  copy: MailboxCopyRef
  /** Stable per copy, so two copies sharing a message id stay two rows. */
  copyId: string
  group: OpenWorkGroup
  /** Where the work stands, with the decision it was read from. */
  work: FollowUpWork
  inbox: InboxStanding
  /** Everything the record and the reading disagree about, in a fixed order. */
  conflicts: readonly WorkConflict[]
  /** The date the open work is owed by, where one was named. */
  dueAt: string | null
  /** Every decision recorded for this copy, latest first, as history. */
  history: readonly FollowUpDecision[]
}>

/** The date open work is owed by, which only open work carries. */
function dueOf(work: FollowUpWork): string | null {
  if (work.state === 'open') return work.dueAt
  return work.state === 'lapsed' ? work.decision.dueAt : null
}

/** Both instants are UTC as `utcInstant` writes them, so they compare as text. */
const isOverdue = (dueAt: string | null, now: string) => dueAt !== null && dueAt < now

function groupOf(work: FollowUpWork, dueAt: string | null, now: string): OpenWorkGroup {
  if (work.state === 'unobserved' || work.state === 'undecided') return 'unknown'
  if (work.state === 'handled') return 'completed'
  return isOverdue(dueAt, now) ? 'overdue' : 'open'
}

function conflictsOf(work: FollowUpWork, inbox: InboxStanding): readonly WorkConflict[] {
  const closed = work.state === 'handled'
  return [
    ...(work.state === 'lapsed' ? (['version_drift'] as const) : []),
    ...(inbox.status === 'not_in_inbox' && !closed ? (['left_inbox'] as const) : []),
    ...(inbox.status === 'in_inbox' && closed ? (['handled_still_in_inbox'] as const) : []),
    ...(work.state === 'unobserved' || inbox.status === 'unknown' ? (['unverified'] as const) : []),
  ]
}

/**
 * One copy's item, or nothing where the record holds no decision for it. The
 * version the reading observed decides whether the latest decision still
 * describes the copy; `followUpWork` owns that comparison, so nothing here
 * can quietly disagree with the reader about the same copy.
 */
export function openWorkItem(record: WorkCopyRecord, now: string): OpenWorkItem | null {
  if (record.decisions.length === 0) return null
  const work = followUpWork(
    record.decisions,
    record.observation === undefined ? [] : [record.observation],
  )
  const inbox = inboxStanding(record.evidence)
  const dueAt = dueOf(work)
  return {
    copy: record.copy,
    copyId: mailboxCopyId(record.copy),
    group: groupOf(work, dueAt, now),
    work,
    inbox,
    conflicts: conflictsOf(work, inbox),
    dueAt,
    history: record.decisions,
  }
}

const groupOrder: Readonly<Record<OpenWorkGroup, number>> = {
  overdue: 0,
  open: 1,
  unknown: 2,
  completed: 3,
}

/** The soonest date first, then work nobody dated. */
const byDue = (a: OpenWorkItem, b: OpenWorkItem) => {
  if (a.dueAt === b.dueAt) return 0
  if (a.dueAt === null) return 1
  if (b.dueAt === null) return -1
  return a.dueAt < b.dueAt ? -1 : 1
}

/**
 * Every copy's recorded work, most pressing first: what is late, then what is
 * owed, then what could not be checked, then what was closed. Copies the
 * record holds nothing for are left out, which is not an error. Order within
 * a group is by the date owed and otherwise the order given, which the store
 * hands over latest-decision first.
 */
export function openWorkList(
  records: readonly WorkCopyRecord[],
  now: string,
): readonly OpenWorkItem[] {
  return records
    .flatMap((record) => openWorkItem(record, now) ?? [])
    .sort((a, b) => groupOrder[a.group] - groupOrder[b.group] || byDue(a, b))
}

/**
 * How much work this application holds, counted from its own records. Every
 * number is of mailbox copies it recorded a decision about, so none of them
 * is a Spark Inbox figure and the two are never added together.
 */
export type OpenWorkTally = Readonly<{
  /** Mailbox copies the record names at all. */
  copies: number
  /** Copies owing work by a date that has not passed, or by no date. */
  open: number
  /** Copies owing work past the date somebody named. */
  overdue: number
  /** Copies whose latest decision closed the work. */
  completed: number
  /** Copies whose recorded work could not be placed against this reading. */
  unknown: number
  /** Copies the record and the reading disagree about, however they do. */
  conflicts: number
}>

const inGroup = (items: readonly OpenWorkItem[], group: OpenWorkGroup) =>
  items.filter((item) => item.group === group).length

/** What the list holds, group by group, plus how much of it disagrees. */
export const openWorkTally = (items: readonly OpenWorkItem[]): OpenWorkTally => ({
  copies: items.length,
  open: inGroup(items, 'open'),
  overdue: inGroup(items, 'overdue'),
  completed: inGroup(items, 'completed'),
  unknown: inGroup(items, 'unknown'),
  conflicts: items.filter((item) => item.conflicts.length > 0).length,
})

/** Copies that still owe work, late or not, which is what "open work" counts. */
export const owedCount = (tally: OpenWorkTally) => tally.open + tally.overdue

/** Whether an item's latest decision may be reopened, as the store's rule has it. */
export const canReopen = (item: OpenWorkItem) => item.history[0]?.kind === 'handled_in_spark'
