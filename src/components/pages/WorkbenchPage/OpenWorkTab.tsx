import { useState, type ReactNode } from 'react'
import type {
  MailboxReachOf,
  RecordedWork,
  WorkDecisionOutcome,
  WorkDecisionRequest,
} from '../../../app/open-work'
import { followUpWork, type FollowUpWork } from '../../../domain/follow-up'
import { WorkspaceTabs } from '../../molecules/WorkspaceTabs/WorkspaceTabs'
import { OpenWorkPanel } from '../../organisms/OpenWorkPanel/OpenWorkPanel'
import type { SidebarItem } from '../../organisms/Sidebar/Sidebar'
import type { QueueScope } from './scope'
import type { WorkSaving } from './useWorkSave'
import {
  mailboxLabels,
  openWorkCount,
  openWorkEmpty,
  openWorkView,
  workRecordsIn,
  type OpenWorkView,
  type WorkReading,
} from './work'
import type { WorkbenchMessage } from './workbench'

/**
 * The work saved in this app, as the page takes it: what the local record
 * held when it was read, what the reading proved about each mailbox, and
 * where decisions are saved. Nothing here reaches a provider.
 */
export type WorkbenchWork = Readonly<{
  recorded: RecordedWork
  /** What the reading proved about each mailbox across both Inbox views. */
  reachOf?: MailboxReachOf | undefined
  onRecord: (request: WorkDecisionRequest) => Promise<WorkDecisionOutcome>
  /** Called once the store confirmed a save, so the record can be read again. */
  onChanged: () => void
  /** The instant overdue is measured against. Defaults to this computer's clock. */
  now?: (() => string) | undefined
}>

export type WorkTab = 'inbox' | 'work'

const reopenText = (outcome: WorkDecisionOutcome) => {
  if (outcome.status === 'recorded') return 'Reopened. The work is open again in this app.'
  if (outcome.status === 'unknown') {
    return 'The reopen may or may not have been saved. Refresh and check before trying again.'
  }
  return 'Not reopened: the local work record did not take it. Nothing changed in Spark.'
}

/**
 * The Open work tab's data and its one write: reopening a closure against
 * the exact mailbox copy and thread version it was saved for.
 */
export function useOpenWork(
  work: WorkbenchWork | undefined,
  reading: WorkReading,
  mailboxes: readonly SidebarItem[],
) {
  const [busyId, setBusyId] = useState<string>()
  const [status, setStatus] = useState('')
  if (work === undefined) return undefined
  const now = work.now?.() ?? new Date().toISOString()
  const view = openWorkView(work.recorded, reading, { labelOf: mailboxLabels(mailboxes) }, now)
  const reopen = (id: string) => {
    const target = view.sections
      .flatMap(({ items }) => items)
      .find((item) => item.id === id)?.reopen
    if (target === undefined || busyId !== undefined) return
    setBusyId(id)
    setStatus('Reopening…')
    void work
      .onRecord({ requestId: crypto.randomUUID(), kind: 'reopen', target, dueAt: null })
      .catch((): WorkDecisionOutcome => ({ status: 'unknown' }))
      .then((outcome) => {
        setBusyId(undefined)
        setStatus(reopenText(outcome))
        if (outcome.status === 'recorded') work.onChanged()
      })
  }
  return { view, reopen, busyId, status } as const
}

type OpenWork = NonNullable<ReturnType<typeof useOpenWork>>

/**
 * Where the saved work on the open row's copy stands against this reading,
 * for the reader's readback, or nothing where nobody decided about it.
 */
export function storedWorkFor(
  recorded: RecordedWork,
  reading: WorkReading,
  open: WorkbenchMessage | undefined,
): FollowUpWork | undefined {
  if (recorded.status !== 'ready' || open?.messageId === undefined) return undefined
  const copy = recorded.copies.find(
    ({ copy: each }) => each.mailboxId === open.mailbox && each.messageId === open.messageId,
  )
  if (copy === undefined) return undefined
  const [record] = workRecordsIn([copy], reading)
  return followUpWork(copy.decisions, record?.observation === undefined ? [] : [record.observation])
}

/** Where the reader saves decisions, or nothing where the page has no record. */
export const workSaving = (
  work: WorkbenchWork | undefined,
  stored: FollowUpWork | undefined,
): WorkSaving | undefined =>
  work === undefined ? undefined : { onRecord: work.onRecord, stored, onSaved: work.onChanged }

/** What the Inbox tab's count is of: this reading's loaded rows, never a mailbox. */
function inboxTab(scope: QueueScope | undefined, loaded: number) {
  const kind = scope?.view === 'other' ? 'read ' : scope?.view === 'unread' ? 'unread ' : ''
  return {
    id: 'inbox',
    label: 'Spark Inbox',
    count: `${String(scope?.loaded ?? loaded)} loaded`,
    countLabel: `${kind}messages loaded from Spark`,
  }
}

const workTab = (view: OpenWorkView) => ({
  id: 'work',
  label: 'Open work',
  count: openWorkCount(view),
  countLabel: 'open items saved in this app',
})

type QueuePaneProps = Readonly<{
  openWork: OpenWork | undefined
  tab: WorkTab
  onTab: (tab: WorkTab) => void
  scope: QueueScope | undefined
  loaded: number
  /** The Inbox queue, shown while its tab is current. */
  inbox: ReactNode
  onOpen: (rowId: string) => void
}>

/**
 * The queue pane: the Inbox alone where the page has no work record, or the
 * two tabs and whichever list is current. Both lists fill the pane and
 * scroll on their own, so the tabs stay in reach at every width.
 */
export function QueuePane({ openWork, tab, onTab, scope, loaded, inbox, onOpen }: QueuePaneProps) {
  if (openWork === undefined) return inbox
  const { view } = openWork
  return (
    <div className="workbench-page__queue-pane">
      <WorkspaceTabs
        label="Workbench lists"
        tabs={[inboxTab(scope, loaded), workTab(view)]}
        current={tab}
        onSelect={(id) => {
          onTab(id === 'work' ? 'work' : 'inbox')
        }}
      />
      <div className="workbench-page__queue-list">
        {tab === 'inbox' ? (
          inbox
        ) : (
          <OpenWorkPanel
            header={{
              title: 'Open work',
              count: view.count,
              context: view.context,
              note: view.note,
            }}
            sections={view.sections}
            empty={openWorkEmpty(view)}
            onOpen={onOpen}
            onReopen={openWork.reopen}
            busyId={openWork.busyId}
            status={openWork.status}
          />
        )}
      </div>
    </div>
  )
}
