/**
 * How the workbench shows the recorded work list: which reading evidence
 * each recorded copy is measured against, and the words for every item,
 * count and empty state in the Open work tab.
 *
 * Plain functions of plain data, like `handling.ts` beside it. Nothing here
 * reads a store, records a decision or reaches a provider.
 *
 * What the copy must never do, and the reason this module owns it:
 *
 * - Mix its counts with Spark's. Every figure here is of copies this app
 *   saved a decision about, and says so; the Inbox tab keeps its own.
 * - Assume a copy's Inbox standing. Listed is in the Inbox, a mailbox read
 *   to the end in both views without it is not, and anything else is
 *   unknown and says which limit stopped it.
 * - Make an old decision current. A saved decision the thread has moved past
 *   is shown as out of date with the work open, and a copy whose version this
 *   reading does not name is shown as not checked.
 * - Merge copies. One delivery to an address and an alias is two items, each
 *   named by the mailbox it was listed in.
 * - Call "Handled in Spark" done. It is listed as completed here, as the
 *   person's own claim.
 */
import type { MailboxReachOf, RecordedWork, RecordedWorkCopy } from '../../../app/open-work'
import {
  canReopen,
  openWorkList,
  openWorkTally,
  owedCount,
  type InboxEvidence,
  type InboxStanding,
  type OpenWorkGroup,
  type OpenWorkItem,
  type OpenWorkTally,
  type WorkConflict,
  type WorkCopyRecord,
} from '../../../domain/open-work'
import type { TargetObservation } from '../../../domain/mailbox-action'
import { mailboxCopyId, type MailboxCopyRef } from '../../../domain/mailbox-copy'
import type { SidebarItem } from '../../organisms/Sidebar/Sidebar'
import { observationIn } from './action'
import { judgedText } from './classification'
import type { ListedEvidence } from './classification'
import { dueText, kindLabels } from './work-save'
import type { WorkbenchMessage } from './workbench'

type Tone = 'neutral' | 'review' | 'done' | 'danger'

/** What the page's current reading can say about recorded copies. */
export type WorkReading = Readonly<{
  messages: readonly WorkbenchMessage[]
  classifications?: ListedEvidence | undefined
  /** What the reading proved about each mailbox across both Inbox views. */
  reachOf?: MailboxReachOf | undefined
  /** A thread the provider just returned for the open row, where there is one. */
  openRead?: TargetObservation | undefined
}>

const sameCopy = (a: MailboxCopyRef, b: MailboxCopyRef) => mailboxCopyId(a) === mailboxCopyId(b)

/** The listed row that is this exact copy, if the reading listed it. */
const rowFor = (copy: MailboxCopyRef, messages: readonly WorkbenchMessage[]) =>
  messages.find(
    (message) => message.mailbox === copy.mailboxId && message.messageId === copy.messageId,
  )

const unlistedEvidence = {
  complete: { reach: 'read_completely' },
  bounded: { reach: 'bounded' },
  unreadable: { reach: 'unreadable' },
  absent: { reach: 'absent' },
} as const satisfies Record<ReturnType<MailboxReachOf>, InboxEvidence>

function evidenceFor(copy: MailboxCopyRef, reading: WorkReading): InboxEvidence {
  const row = rowFor(copy, reading.messages)
  if (row !== undefined) return { reach: 'listed', view: row.unread === false ? 'read' : 'unread' }
  // Without any proof of reach, absence from the rows proves nothing.
  return unlistedEvidence[reading.reachOf?.(copy.mailboxId) ?? 'bounded']
}

function observationFor(copy: MailboxCopyRef, reading: WorkReading) {
  if (reading.openRead !== undefined && sameCopy(reading.openRead.copy, copy)) {
    return reading.openRead
  }
  const row = rowFor(copy, reading.messages)
  if (row === undefined) return undefined
  return observationIn(reading.classifications?.states[row.id])
}

/** Every recorded copy with what this reading proves about it. */
export const workRecordsIn = (
  copies: readonly RecordedWorkCopy[],
  reading: WorkReading,
): readonly WorkCopyRecord[] =>
  copies.map(({ copy, decisions }) => ({
    copy,
    decisions,
    evidence: evidenceFor(copy, reading),
    observation: observationFor(copy, reading),
  }))

/** One item as the Open work tab shows it. */
export type WorkItemView = Readonly<{
  id: string
  /** The listed subject, or the provider message id where the reading lists none. */
  title: string
  /** The mailbox this copy is in, as the rail names it. Never merged with another. */
  source: string
  decision: Readonly<{ label: string; tone: Tone }>
  standing: Readonly<{ label: string; tone: Tone }>
  /** Who saved the latest decision, and when, with the due date where one was named. */
  saved: string
  /** Where the copy stands in the Spark Inbox, as evidence allows. */
  inbox: string
  /** Every disagreement between the record and the reading, in words. */
  conflicts: readonly string[]
  /** The listed row to open in the reader, where the reading lists this copy. */
  rowId?: string | undefined
  /** The copy and version a reopen is recorded against, where one may be. */
  reopen?: Readonly<{ copy: MailboxCopyRef; threadId: string; latestMessageId: string }> | undefined
}>

const standings: Readonly<Record<OpenWorkGroup, Readonly<{ label: string; tone: Tone }>>> = {
  overdue: { label: 'Overdue', tone: 'danger' },
  open: { label: 'Open', tone: 'review' },
  unknown: { label: 'Version not checked', tone: 'review' },
  completed: { label: 'Completed · your claim', tone: 'neutral' },
}

const inboxWords = {
  bounded_reading: 'Spark Inbox unknown: the loaded reading may not reach it',
  mailbox_unreadable: 'Spark Inbox unknown: this mailbox could not be read',
  mailbox_absent: 'Spark Inbox unknown: this mailbox is not in the reading',
} as const

function inboxText(inbox: InboxStanding): string {
  if (inbox.status === 'in_inbox') {
    return inbox.view === 'unread' ? 'In Spark Inbox · unread' : 'In Spark Inbox · read'
  }
  if (inbox.status === 'not_in_inbox') return 'Not in Spark Inbox · both views read completely'
  return inboxWords[inbox.reason]
}

const conflictWords = {
  version_drift:
    'Out of date: the thread has a newer version than the one this was saved for, so the work is open again. Decide again in the reader.',
  left_inbox:
    'No longer in the Spark Inbox, yet work is still saved as owed here. Nothing here moved it; decide again if it is finished.',
  handled_still_in_inbox:
    'Saved as handled in Spark, yet Spark still lists it in the Inbox. Your claim is kept as it is.',
  unverified:
    'Not verified: this reading cannot confirm where this copy is or which version it holds.',
} as const satisfies Record<WorkConflict, string>

function savedText(item: OpenWorkItem): string {
  const [latest] = item.history
  if (latest === undefined) return ''
  const due = item.dueAt === null ? '' : ` · due ${dueText(item.dueAt)}`
  const earlier = item.history.length - 1
  const history = earlier > 0 ? ` · ${String(earlier)} earlier` : ''
  return `Saved by ${latest.decidedBy} on ${judgedText(latest.decidedAt)}${due}${history}`
}

type Labels = Readonly<{ labelOf: (mailboxId: string) => string }>

/** One item in words, with the row to open and the reopen it offers. */
export function workItemView(
  item: OpenWorkItem,
  reading: WorkReading,
  { labelOf }: Labels,
): WorkItemView {
  const row = rowFor(item.copy, reading.messages)
  const latest = item.history[0]
  return {
    id: item.copyId,
    title: row?.subject ?? `Message ${item.copy.messageId} (not in this reading)`,
    source: labelOf(item.copy.mailboxId),
    decision: {
      label: latest === undefined ? 'No decision' : kindLabels[latest.kind],
      tone: latest?.kind === 'handled_in_spark' ? 'neutral' : 'review',
    },
    standing: standings[item.group],
    saved: savedText(item),
    inbox: inboxText(item.inbox),
    conflicts: item.conflicts.map((conflict) => conflictWords[conflict]),
    rowId: row?.id,
    // Only a closure that still stands is reopened; lapsed work is open already.
    reopen:
      item.group === 'completed' && canReopen(item) && latest !== undefined
        ? latest.target
        : undefined,
  }
}

/** The list's sections, most pressing first. Empty sections are left out. */
const sectionTitles = {
  overdue: 'Overdue follow-up',
  open: 'Open work',
  unknown: 'Not checked against this reading',
  completed: 'Completed here',
} as const satisfies Record<OpenWorkGroup, string>

export type WorkSectionView = Readonly<{
  id: OpenWorkGroup
  title: string
  count: string
  items: readonly WorkItemView[]
}>

const sectionOrder: readonly OpenWorkGroup[] = ['overdue', 'open', 'unknown', 'completed']

function sectionsOf(views: readonly (readonly [OpenWorkItem, WorkItemView])[]) {
  return sectionOrder.flatMap((group): WorkSectionView[] => {
    const items = views.filter(([item]) => item.group === group).map(([, view]) => view)
    if (items.length === 0) return []
    return [{ id: group, title: sectionTitles[group], count: String(items.length), items }]
  })
}

/** What the Open work tab shows. */
export type OpenWorkView = Readonly<{
  status: 'ready' | 'unavailable'
  tally: OpenWorkTally
  /** The header's count line, e.g. "2 open · 1 overdue · 3 completed". */
  count: string
  /** Where the counts come from, so they never read as Spark's. */
  context: string
  /** What may be missing from the list, where anything may be. */
  note?: string | undefined
  sections: readonly WorkSectionView[]
}>

const emptyTally = openWorkTally([])

function countText(tally: OpenWorkTally): string {
  const parts = [
    `${String(tally.open)} open`,
    `${String(tally.overdue)} overdue`,
    `${String(tally.completed)} completed`,
  ]
  if (tally.unknown > 0) parts.push(`${String(tally.unknown)} not checked`)
  return parts.join(' · ')
}

const context =
  'Counted from decisions saved in this app, per mailbox copy. Not a Spark Inbox count.'

/**
 * The whole tab: counts, sections and what may be missing. A record that
 * could not be read is `unavailable` and holds no sections, never an empty
 * list; one that holds nothing is ready and empty.
 */
export function openWorkView(
  recorded: RecordedWork,
  reading: WorkReading,
  labels: Labels,
  now: string,
): OpenWorkView {
  if (recorded.status === 'unavailable') {
    return { status: 'unavailable', tally: emptyTally, count: 'Not read', context, sections: [] }
  }
  const copies = recorded.status === 'ready' ? recorded.copies : []
  const items = openWorkList(workRecordsIn(copies, reading), now)
  const tally = openWorkTally(items)
  const bounded = recorded.status === 'ready' && recorded.bounded
  return {
    status: 'ready',
    tally,
    count: countText(tally),
    context,
    note: bounded
      ? 'Showing the most recently decided copies only; older ones are not listed.'
      : undefined,
    sections: sectionsOf(items.map((item) => [item, workItemView(item, reading, labels)] as const)),
  }
}

/** The Open work tab's count: copies that still owe work, late or not. */
export const openWorkCount = (view: OpenWorkView) =>
  view.status === 'ready' ? String(owedCount(view.tally)) : '?'

/** What the tab says when it holds no open work, distinct from every Inbox empty state. */
export function openWorkEmpty(
  view: OpenWorkView,
): Readonly<{ title: string; description: string }> | null {
  if (view.status === 'unavailable') {
    return {
      title: 'Open work could not be read',
      description:
        'The local work record did not answer, so nothing here is known. Your Spark Inbox is unaffected. Refresh to try again.',
    }
  }
  if (owedCount(view.tally) > 0 || view.tally.unknown > 0) return null
  return {
    title: 'No open work saved here',
    description:
      view.tally.completed > 0
        ? 'Nothing saved in this app is still owed. Completed decisions are listed below. This says nothing about your Spark Inbox.'
        : 'Nothing was saved as Reply needed, Follow up later or Handled in Spark in this app. This says nothing about your Spark Inbox.',
  }
}

/** How a mailbox is named here: as the rail names it, else by its own id. */
export const mailboxLabels = (mailboxes: readonly SidebarItem[]) => (mailboxId: string) =>
  mailboxes.find((item) => item.id === mailboxId)?.label ?? mailboxId
