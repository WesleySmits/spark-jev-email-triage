import { useEffect, useId, useRef, useState, type ComponentProps, type RefObject } from 'react'
import { EmptyState } from '../../molecules/EmptyState/EmptyState'
import { MessageQueue } from '../../organisms/MessageQueue/MessageQueue'
import { MessageReader } from '../../organisms/MessageReader/MessageReader'
import { Sidebar, type SidebarItem } from '../../organisms/Sidebar/Sidebar'
import { TopBar } from '../../organisms/TopBar/TopBar'
import { WorkbenchTemplate } from '../../templates/WorkbenchTemplate/WorkbenchTemplate'
import { shortcutLegend, useWorkbenchShortcuts } from './useWorkbenchShortcuts'
import {
  afterRemoval,
  allMailboxes,
  neighbour,
  railGroups,
  visibleMessages,
  type WorkbenchFilter,
  type WorkbenchMessage,
} from './workbench'
import './WorkbenchPage.css'

type Pane = ComponentProps<typeof WorkbenchTemplate>['mobilePane']

type WorkbenchPageProps = Readonly<{
  /** Every message the page can show, in display order. The caller loads them. */
  messages: readonly WorkbenchMessage[]
  /** The workflow filters, e.g. Needs review. The first is applied at the start. Counts are filled in. */
  workflows: readonly SidebarItem[]
  /**
   * The mailbox filters, one per account. Each id is the account marker its
   * messages carry. "All accounts" is added in front; counts are filled in.
   */
  mailboxes: readonly SidebarItem[]
  /**
   * Marks the open message done, from its Complete button or `E`. The caller
   * changes the data, e.g. moves it to the Done workflow; the page opens the
   * next message in the list.
   */
  onComplete: (id: string) => void
  /** Sync status and profile. The page owns the search. */
  topBar: Omit<
    ComponentProps<typeof TopBar>,
    | 'searchLabel'
    | 'searchPlaceholder'
    | 'searchValue'
    | 'onSearchChange'
    | 'onSearchSubmit'
    | 'searchShortcut'
    | 'searchId'
  >
}>

const readerContent = '.workbench__reader [role="region"][tabindex]'
const currentRow = '.workbench__queue [aria-current="true"]'
const firstRow = '.workbench__queue li button'

/** The page's own state: filters, the open message and the mobile pane. */
function usePageState(
  messages: readonly WorkbenchMessage[],
  workflows: readonly SidebarItem[],
  onComplete: (id: string) => void,
) {
  const [initial] = useState<WorkbenchFilter>(() => ({
    workflow: workflows[0]?.id ?? '',
    mailbox: allMailboxes,
    query: '',
  }))
  const [filter, setFilter] = useState(initial)
  const shown = visibleMessages(messages, filter)
  const [openId, setOpenId] = useState(shown[0]?.id)
  const [pane, setPane] = useState<Pane>('queue')
  const open = shown.find((message) => message.id === openId)
  return {
    filter,
    shown,
    open,
    pane: open ? pane : 'queue',
    filterBy: (change: Partial<WorkbenchFilter>) => {
      setFilter({ ...filter, ...change })
      setPane('queue')
    },
    reset: () => {
      setFilter(initial)
    },
    openMessage: (id: string) => {
      setOpenId(id)
      setPane('reader')
    },
    step: (by: 1 | -1) => {
      setOpenId(neighbour(shown, open?.id, by))
    },
    complete: () => {
      if (!open) return
      setOpenId(afterRemoval(shown, open.id))
      onComplete(open.id)
    },
    back: () => {
      setPane('queue')
    },
  } as const
}

type PageState = ReturnType<typeof usePageState>
type Root = RefObject<HTMLDivElement | null>

/** Moves focus into the pane that shows when a mobile switch hid the focused control. */
function useFocusShownPane(root: Root, pane: Pane) {
  useEffect(() => {
    const active = document.activeElement
    if (!(active instanceof HTMLElement) || active.checkVisibility()) return
    root.current
      ?.querySelector<HTMLElement>(pane === 'reader' ? readerContent : currentRow)
      ?.focus()
  }, [root, pane])
}

/** Keeps the open row in view, and brings focus along when it was on a row. */
function useFollowCurrentRow(root: Root, openId: string | undefined) {
  useEffect(() => {
    const row = root.current?.querySelector<HTMLElement>(currentRow)
    row?.scrollIntoView({ block: 'nearest' })
    if (document.activeElement?.closest('.workbench__queue li')) row?.focus()
  }, [root, openId])
}

function useShortcuts(state: PageState, searchId: string) {
  useWorkbenchShortcuts({
    next: () => {
      state.step(1)
    },
    previous: () => {
      state.step(-1)
    },
    complete: state.complete,
    search: () => {
      document.getElementById(searchId)?.focus()
    },
  })
}

type PaneProps = Readonly<{ state: PageState; title: string }>

function Queue({ state, title }: PaneProps) {
  const count = state.shown.length
  return (
    <MessageQueue
      header={{
        title,
        headingLevel: 1,
        count: `${String(count)} ${count === 1 ? 'result' : 'results'}`,
        context: 'Current filter',
      }}
      messages={state.shown}
      currentId={state.open?.id}
      onOpen={state.openMessage}
      empty={
        <EmptyState
          icon="inbox"
          title="No results in this filter"
          description="Choose another workflow or mailbox, or clear the search."
          action={{ label: 'Reset filters', onClick: state.reset }}
        />
      }
    />
  )
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join('')
}

function Reader({ state, title }: PaneProps) {
  const { shown, open } = state
  if (!open) {
    return (
      <EmptyState
        icon="inbox"
        title="No message open"
        description="Choose a message in the list to read it here."
      />
    )
  }
  const position = `${String(shown.indexOf(open) + 1)} of ${String(shown.length)} in ${title}`
  return (
    <MessageReader
      key={open.id}
      mobileBar={{ title: open.account.label, context: position, onBack: state.back }}
      header={{
        subject: open.subject,
        status: open.status,
        sender: {
          name: open.sender,
          initials: initials(open.sender),
          address: open.address,
          account: open.account,
          time: open.time,
          dateTime: open.dateTime,
        },
      }}
      actions={{
        primaryAction: { label: 'Complete', icon: 'check', shortcut: 'E', onClick: state.complete },
      }}
    >
      {open.body.split(/\n{2,}/).map((paragraph, index) => (
        <p key={index}>{paragraph}</p>
      ))}
    </MessageReader>
  )
}

/**
 * The triage workbench: the Compact workbench template filled with the rail,
 * search, queue and reader, and the state that ties them together.
 *
 * The page owns the UI state: the workflow and mailbox filters, the search,
 * which message is open, the mobile pane, focus on pane switches, and the
 * J, K, E and / shortcuts shown in the rail and search field. The caller owns
 * the data: it passes the messages and decides what Complete does. The page
 * fetches nothing and changes no mail. Give it a bounded parent such as a
 * `100dvh` root.
 *
 * @example
 * import { WorkbenchPage } from '../components/pages/WorkbenchPage/WorkbenchPage'
 *
 * <div style={{ height: '100dvh' }}>
 *   <WorkbenchPage
 *     messages={messages}
 *     workflows={[{ id: 'review', icon: 'clock', label: 'Needs review' }]}
 *     mailboxes={[{ id: 'studio', account: 'studio', label: 'Studio Noord' }]}
 *     onComplete={markDone}
 *     topBar={{ syncStatus: 'connected', syncLabel: 'Updated 2 min ago', onSyncClick, profileLabel: 'Profile Wesley Smits', profileInitials: 'WS' }}
 *   />
 * </div>
 */
export function WorkbenchPage({
  messages,
  workflows,
  mailboxes,
  onComplete,
  topBar,
}: WorkbenchPageProps) {
  const state = usePageState(messages, workflows, onComplete)
  const searchId = useId()
  const root = useRef<HTMLDivElement>(null)
  useShortcuts(state, searchId)
  useFocusShownPane(root, state.pane)
  useFollowCurrentRow(root, state.open?.id)
  const title = workflows.find((item) => item.id === state.filter.workflow)?.label ?? ''
  return (
    <div ref={root} className="workbench-page">
      <WorkbenchTemplate
        mobilePane={state.pane}
        topBar={
          <TopBar
            {...topBar}
            searchId={searchId}
            searchLabel="Search current results"
            searchPlaceholder="Search current results"
            searchValue={state.filter.query}
            onSearchChange={(query) => {
              state.filterBy({ query })
            }}
            onSearchSubmit={() => {
              const queue = root.current
              ;(
                queue?.querySelector<HTMLElement>(currentRow) ??
                queue?.querySelector<HTMLElement>(firstRow)
              )?.focus()
            }}
          />
        }
        sidebar={
          <Sidebar
            label="Filters"
            groups={railGroups({ messages, filter: state.filter, workflows, mailboxes })}
            onSelect={(groupId, itemId) => {
              state.filterBy({ [groupId]: itemId })
            }}
            shortcuts={shortcutLegend}
          />
        }
        queue={<Queue state={state} title={title} />}
        reader={<Reader state={state} title={title} />}
      />
    </div>
  )
}
