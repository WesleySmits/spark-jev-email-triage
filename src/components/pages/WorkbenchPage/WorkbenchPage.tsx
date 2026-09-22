import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentProps,
  type RefObject,
} from 'react'
import { EmptyState } from '../../molecules/EmptyState/EmptyState'
import { LocalStatusToast } from '../../molecules/LocalStatusToast/LocalStatusToast'
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
   * new version of the completed message, the page leaves it out. Return a
   * promise to report the outcome: when it rejects, the message comes back,
   * and the Completed notice only shows once it resolves.
   */
  onComplete: (id: string) => void | Promise<void>
  /**
   * Undoes a completion from the Completed notice. The caller puts the message
   * back; the page opens it again. Left out: the notice has no Undo.
   */
  onUndoComplete?: ((id: string) => void) | undefined
  /** The Completed notice's second line, e.g. "Mailbox unchanged." */
  completedNote?: string | undefined
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

type PageInput = Pick<WorkbenchPageProps, 'messages' | 'workflows' | 'mailboxes' | 'onComplete'>

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
  const keep = (keepIf: (item: WorkbenchMessage) => boolean) => {
    setPending((current) => new Set([...current].filter(keepIf)))
  }
  return {
    live,
    markPending: (message: WorkbenchMessage) => {
      keep((item) => messages.includes(item))
      setPending((current) => new Set(current).add(message))
    },
    /** Shows a message again, e.g. when its completion failed or was undone. */
    release: (message: WorkbenchMessage) => {
      keep((item) => item !== message)
    },
  } as const
}

/**
 * The page's own state: the chosen filters, the chosen message and the
 * mobile pane. What applies is worked out from the current props on every
 * render, so data that arrives or changes after mount still shows.
 * `generation` counts the user's navigation: J, K, opening a row and
 * changing a filter each move it on.
 */
function usePageState({ messages, workflows, mailboxes, onComplete }: PageInput) {
  const [chosen, setChosen] = useState(defaultFilter)
  const [openId, setOpenId] = useState<string>()
  const [pane, setPane] = useState<Pane>('queue')
  const [generation, setGeneration] = useState(0)
  const moveOn = () => {
    setGeneration((current) => current + 1)
  }
  const { live, markPending, release } = usePendingCompletion(messages)
  const filter = appliedFilter(chosen, workflows, mailboxes)
  const shown = visibleMessages(live, filter)
  const open = openedMessage(shown, openId)
  // With nothing to read, the reader can't be the mobile pane, now or later.
  if (!open && pane === 'reader') setPane('queue')
  const filterBy = (change: Partial<WorkbenchFilter>) => {
    setChosen({ ...filter, ...change })
    setPane('queue')
    moveOn()
  }
  return {
    messages: live,
    filter,
    shown,
    open,
    pane,
    generation,
    filterBy,
    reset: () => {
      filterBy(defaultFilter)
    },
    openMessage: (id: string) => {
      setOpenId(id)
      setPane('reader')
      moveOn()
    },
    step: (by: 1 | -1) => {
      setOpenId(neighbour(shown, open?.id, by))
      moveOn()
    },
    select: setOpenId,
    release,
    /**
     * Completes the open message. Returns it with the message that opens
     * next, the navigation generation at this moment and the caller's result.
     */
    complete: () => {
      if (!open) return undefined
      markPending(open)
      const next = afterRemoval(shown, open.id)
      setOpenId(next)
      return { message: open, next, generation, result: onComplete(open.id) }
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
function useKeepFocus(
  root: Root,
  restoreRef: RefObject<Place | null>,
  state: PageState,
  noticeOpen: boolean,
) {
  const { pane } = state
  const openId = state.open?.id
  const count = state.shown.length
  useEffect(() => {
    const place = takePlace(restoreRef, pane)
    if (place && root.current) focusInto(root.current, place, openId !== undefined)
  }, [root, restoreRef, pane, openId, count, noticeOpen])
}

/**
 * Calls `done` once the caller's result settles well, `failed` if it
 * rejects. `done` learns whether the result was there at once.
 */
function settle(result: void | Promise<void>, done: (atOnce: boolean) => void, failed: () => void) {
  if (result instanceof Promise) {
    void result.then(() => {
      done(false)
    }, failed)
  } else done(true)
}

/** Where the user is: the navigation generation and the open message. */
type Spot = Readonly<{ generation: number; at: string | undefined }>
type Shown = Spot & Readonly<{ message: WorkbenchMessage }>

const samePlace = (a: Spot, b: Spot) => a.generation === b.generation && a.at === b.at

/** The completed message to show while the user hasn't moved on. */
function noticeFor(shown: Shown | undefined, now: Spot) {
  return shown && samePlace(shown, now) ? shown.message : undefined
}

/** A ref that always holds the latest render's value, for use in callbacks. */
function useLatest<T>(value: T) {
  const ref = useRef(value)
  useLayoutEffect(() => {
    ref.current = value
  })
  return ref
}

/**
 * The Completed notice: the last completed message, shown while the user
 * stays where the completion left them. Moving on, with J, K, a row or a
 * filter, hides it, even when the same message stays open. Hiding it while
 * focus is on its actions sends focus back into the page.
 */
function useCompletedNotice(state: PageState, restoreRef: RefObject<Place | null>) {
  const [shown, setShown] = useState<Shown>()
  const now = { generation: state.generation, at: state.open?.id }
  // Once the user moves on, the notice is gone for good.
  if (shown && !samePlace(shown, now)) setShown(undefined)
  return {
    message: noticeFor(shown, now),
    /** Shows the notice for `completed` while the user stays at `place`. */
    show: (completed: WorkbenchMessage, place: Spot) => {
      setShown({ ...place, message: completed })
    },
    hide: () => {
      if (document.activeElement?.closest('.local-status-toast')) restoreRef.current = state.pane
      setShown(undefined)
    },
  } as const
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

type Notice = ReturnType<typeof useCompletedNotice>

/**
 * Completes the open message: notes where focus was, shows the notice once
 * the caller's result settles, and brings the message back if it fails.
 */
function useComplete(state: PageState, notice: Notice, restoreRef: RefObject<Place | null>) {
  const latest = useLatest<Spot>({ generation: state.generation, at: state.open?.id })
  return () => {
    restoreRef.current = focusedPlace()
    const completion = state.complete()
    if (!completion) return
    // Where the completion leaves the user: the next message, this generation.
    const left = { generation: completion.generation, at: completion.next }
    settle(
      completion.result,
      (atOnce) => {
        // A late result shows only if the user hasn't moved on meanwhile.
        if (atOnce || samePlace(latest.current, left)) notice.show(completion.message, left)
      },
      () => {
        state.release(completion.message)
      },
    )
  }
}

type CompletedNoticeProps = Readonly<{
  notice: Notice
  state: PageState
  note: string | undefined
  onUndoComplete: ((id: string) => void) | undefined
}>

function CompletedNotice({ notice, state, note, onUndoComplete }: CompletedNoticeProps) {
  const { message } = notice
  const undo =
    message && onUndoComplete
      ? () => {
          notice.hide()
          onUndoComplete(message.id)
          state.release(message)
          state.select(message.id)
        }
      : undefined
  return (
    <LocalStatusToast
      visible={notice.message !== undefined}
      title="Completed"
      detail={note}
      actionLabel={undo ? 'Undo' : undefined}
      onAction={undo}
      dismissLabel="Dismiss"
      onDismiss={notice.hide}
    />
  )
}

type PageTopBarProps = Readonly<{
  topBar: WorkbenchPageProps['topBar']
  state: PageState
  searchId: string
  root: Root
}>

/** The top bar with the page's search. Enter moves focus to the results. */
function PageTopBar({ topBar, state, searchId, root }: PageTopBarProps) {
  return (
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
  )
}

type PageRailProps = Readonly<{ state: PageState } & Pick<PageInput, 'workflows' | 'mailboxes'>>

/** The rail with the applied filters, counts and the shortcut legend. */
function PageRail({ state, workflows, mailboxes }: PageRailProps) {
  return (
    <Sidebar
      label="Filters"
      groups={railGroups({ messages: state.messages, filter: state.filter, workflows, mailboxes })}
      onSelect={(groupId, itemId) => {
        state.filterBy({ [groupId]: itemId })
      }}
      shortcuts={shortcutLegend}
    />
  )
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

/** Everything the page ties together: state, focus, the notice and the keys. */
function useWorkbench(props: WorkbenchPageProps) {
  const state = usePageState(props)
  const searchId = useId()
  const root = useRef<HTMLDivElement>(null)
  const restoreRef = useRef<Place | null>(null)
  const notice = useCompletedNotice(state, restoreRef)
  const complete = useComplete(state, notice, restoreRef)
  useShortcuts(root, state, complete, searchId)
  useKeepFocus(root, restoreRef, state, notice.message !== undefined)
  useFollowCurrentRow(root, state.open?.id)
  return { state, searchId, root, notice, complete } as const
}

/**
 * The triage workbench: the Compact workbench template filled with the rail,
 * search, queue and reader, and the state that ties them together.
 *
 * The page owns the UI state: the workflow and mailbox filters, the search,
 * which message is open, the mobile pane, focus on pane switches, and the
 * J, K, E and / shortcuts shown in the rail and search field, and the
 * Completed notice with its optional Undo. The caller owns the data: it
 * passes the messages and decides what Complete and Undo do. The page
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
export function WorkbenchPage(props: WorkbenchPageProps) {
  const { workflows, mailboxes } = props
  const { state, searchId, root, notice, complete } = useWorkbench(props)
  const title = workflows.find((item) => item.id === state.filter.workflow)?.label ?? ''
  return (
    <div ref={root} className="workbench-page">
      <WorkbenchTemplate
        mobilePane={state.pane}
        topBar={<PageTopBar topBar={props.topBar} state={state} searchId={searchId} root={root} />}
        sidebar={<PageRail state={state} workflows={workflows} mailboxes={mailboxes} />}
        queue={<Queue state={state} title={title} />}
        reader={<Reader state={state} title={title} complete={complete} />}
      />
      <CompletedNotice
        notice={notice}
        state={state}
        note={props.completedNote}
        onUndoComplete={props.onUndoComplete}
      />
    </div>
  )
}
