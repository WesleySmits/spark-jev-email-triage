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
  appliedFilter,
  defaultFilter,
  neighbour,
  openedMessage,
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
   * next message in the list. It may update later: until `messages` holds a
   * new version of the completed message, the page leaves it out.
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
const queueControl = '.workbench__queue button'

type PageInput = Readonly<{
  messages: readonly WorkbenchMessage[]
  workflows: readonly SidebarItem[]
  mailboxes: readonly SidebarItem[]
  onComplete: (id: string) => void
}>

const none: ReadonlySet<WorkbenchMessage> = new Set()

/**
 * The messages without those handed to `onComplete` that the caller hasn't
 * changed yet. A caller may update its data later; until it passes a new
 * version of a completed message, that message isn't shown, counted, opened
 * or completed again. The new version shows wherever it now belongs.
 */
function usePendingCompletion(messages: readonly WorkbenchMessage[]) {
  const [pending, setPending] = useState(none)
  const live = messages.filter((message) => !pending.has(message))
  const markPending = (message: WorkbenchMessage) => {
    const unchanged = [...pending].filter((item) => messages.includes(item))
    setPending(new Set(unchanged).add(message))
  }
  return [live, markPending] as const
}

/**
 * The page's own state: the chosen filters, the chosen message and the
 * mobile pane. What applies is worked out from the current props on every
 * render, so data that arrives or changes after mount still shows.
 */
function usePageState({ messages, workflows, mailboxes, onComplete }: PageInput) {
  const [chosen, setChosen] = useState(defaultFilter)
  const [openId, setOpenId] = useState<string>()
  const [pane, setPane] = useState<Pane>('queue')
  const [live, markPending] = usePendingCompletion(messages)
  const filter = appliedFilter(chosen, workflows, mailboxes)
  const shown = visibleMessages(live, filter)
  const open = openedMessage(shown, openId)
  // With nothing to read, the reader can't be the mobile pane, now or later.
  if (!open && pane === 'reader') setPane('queue')
  const filterBy = (change: Partial<WorkbenchFilter>) => {
    setChosen({ ...filter, ...change })
    setPane('queue')
  }
  return {
    messages: live,
    filter,
    shown,
    open,
    pane,
    filterBy,
    reset: () => {
      filterBy(defaultFilter)
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
      markPending(open)
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
type Place = 'queue' | 'reader'

/** Which pane holds focus, if any. */
function focusedPlace(): Place | null {
  const active = document.activeElement
  if (active?.closest('.workbench__reader')) return 'reader'
  return active?.closest('.workbench__queue') ? 'queue' : null
}

function focusIsHidden() {
  const active = document.activeElement
  return active instanceof HTMLElement && !active.checkVisibility()
}

/** Focuses the reader's content, or the open row, else the queue's first control. */
function focusInto(root: HTMLElement, place: Place, hasOpen: boolean) {
  const selectors = place === 'reader' && hasOpen ? [readerContent] : [currentRow, queueControl]
  selectors
    .map((selector) => root.querySelector<HTMLElement>(selector))
    .find(Boolean)
    ?.focus()
}

/** Where focus should go now, if anywhere, and clears the Complete note. */
function takePlace(restoreRef: RefObject<Place | null>, pane: Place) {
  const place = restoreRef.current ?? (focusIsHidden() ? pane : null)
  restoreRef.current = null
  return place
}

/**
 * Keeps focus in the page when the control that had it goes away: a mobile
 * pane switch hides it, and Complete removes the row or reader that held
 * it. `restoreRef` names the pane focus was in before Complete.
 */
function useKeepFocus(root: Root, restoreRef: RefObject<Place | null>, state: PageState) {
  const { pane } = state
  const openId = state.open?.id
  const count = state.shown.length
  useEffect(() => {
    const place = takePlace(restoreRef, pane)
    if (place && root.current) focusInto(root.current, place, openId !== undefined)
  }, [root, restoreRef, pane, openId, count])
}

/** Keeps the open row in view, and brings focus along when it was on a row. */
function useFollowCurrentRow(root: Root, openId: string | undefined) {
  useEffect(() => {
    const row = root.current?.querySelector<HTMLElement>(currentRow)
    row?.scrollIntoView({ block: 'nearest' })
    if (document.activeElement?.closest('.workbench__queue li')) row?.focus()
  }, [root, openId])
}

function useShortcuts(root: Root, state: PageState, complete: () => void, searchId: string) {
  useWorkbenchShortcuts({
    next: () => {
      state.step(1)
    },
    previous: () => {
      state.step(-1)
    },
    // Only what the user can see: on mobile the queue hides the reader.
    complete: () => {
      if (root.current?.querySelector('.workbench__reader')?.checkVisibility()) complete()
    },
    search: () => {
      document.getElementById(searchId)?.focus()
    },
  })
}

type PaneProps = Readonly<{ state: PageState; title: string; complete: () => void }>

function Queue({ state, title }: Omit<PaneProps, 'complete'>) {
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

function Reader({ state, title, complete }: PaneProps) {
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
        primaryAction: { label: 'Complete', icon: 'check', shortcut: 'E', onClick: complete },
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
  const state = usePageState({ messages, workflows, mailboxes, onComplete })
  const searchId = useId()
  const root = useRef<HTMLDivElement>(null)
  const restoreRef = useRef<Place | null>(null)
  const complete = () => {
    restoreRef.current = focusedPlace()
    state.complete()
  }
  useShortcuts(root, state, complete, searchId)
  useKeepFocus(root, restoreRef, state)
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
              if (root.current) focusInto(root.current, 'queue', false)
            }}
          />
        }
        sidebar={
          <Sidebar
            label="Filters"
            groups={railGroups({
              messages: state.messages,
              filter: state.filter,
              workflows,
              mailboxes,
            })}
            onSelect={(groupId, itemId) => {
              state.filterBy({ [groupId]: itemId })
            }}
            shortcuts={shortcutLegend}
          />
        }
        queue={<Queue state={state} title={title} />}
        reader={<Reader state={state} title={title} complete={complete} />}
      />
    </div>
  )
}
