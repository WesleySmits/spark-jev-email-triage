import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentProps,
  type RefObject,
} from 'react'
import type { BodyLoader } from '../../../app/inbox'
import { DisconnectedState } from '../../molecules/DisconnectedState/DisconnectedState'
import { EmptyState } from '../../molecules/EmptyState/EmptyState'
import { LocalStatusToast } from '../../molecules/LocalStatusToast/LocalStatusToast'
import { MessageQueue } from '../../organisms/MessageQueue/MessageQueue'
import { MessageReader } from '../../organisms/MessageReader/MessageReader'
import { formatMessageBody } from '../../organisms/MessageReader/formatMessageBody'
import { Sidebar, type SidebarItem } from '../../organisms/Sidebar/Sidebar'
import { TopBar } from '../../organisms/TopBar/TopBar'
import { WorkbenchTemplate } from '../../templates/WorkbenchTemplate/WorkbenchTemplate'
import type { BodyState } from './body'
import { useMessageBody } from './useMessageBody'
import { shortcutLegend, useWorkbenchShortcuts } from './useWorkbenchShortcuts'
import {
  afterRemoval,
  appliedFilter,
  defaultFilter,
  mailboxLabel,
  neighbour,
  openedMessage,
  railGroups,
  visibleMessages,
  type WorkbenchFilter,
  type WorkbenchMessage,
} from './workbench'
import './WorkbenchPage.css'

type Pane = ComponentProps<typeof WorkbenchTemplate>['mobilePane']

/**
 * What Complete may do. `read-only` shows no Complete button, ignores `E`
 * and never shows the Completed notice: the page offers no way to change mail.
 */
type WorkbenchCompletion =
  | Readonly<{ mode: 'read-only' }>
  | Readonly<{
      mode: 'enabled'
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
      note?: string | undefined
    }>

type WorkbenchPageProps = Readonly<{
  /** Every message the page can show, in display order, without bodies. The caller loads them. */
  messages: readonly WorkbenchMessage[]
  /**
   * Loads a message's body when it opens, and again on Try again. Only the
   * open message's body is asked for; a response for a message that is no
   * longer open is dropped.
   */
  loadBody: BodyLoader
  /** The workflow filters, e.g. Needs review. The first is applied at the start. Counts are filled in. */
  workflows: readonly SidebarItem[]
  /**
   * The mailbox filters, one per mailbox. Each id is the `mailbox` its
   * messages carry. "All accounts" is added in front; counts are filled in.
   */
  mailboxes: readonly SidebarItem[]
  /** Whether Complete is offered, and what it does. */
  completion: WorkbenchCompletion
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
// The rows are where the list is read, so the keys still act from them.
const queueRow = '.workbench__queue .message-row__button'

type PageInput = Pick<WorkbenchPageProps, 'messages' | 'workflows' | 'mailboxes' | 'completion'>

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
 * `generation` counts the user's navigation: K, J, opening a row and
 * changing a filter each move it on.
 */
function usePageState({ messages, workflows, mailboxes, completion }: PageInput) {
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
    /** Opens the next (1) or previous (-1) row. With no rows it does nothing. */
    step: (by: 1 | -1) => {
      if (shown.length === 0) return
      setOpenId(neighbour(shown, open?.id, by))
      moveOn()
    },
    select: setOpenId,
    release,
    /**
     * Completes the open message, unless the page is read-only. Returns it
     * with the message that opens next, the navigation generation at this
     * moment and the caller's result.
     */
    complete: () => {
      if (!open || completion.mode === 'read-only') return undefined
      markPending(open)
      const next = afterRemoval(shown, open.id)
      setOpenId(next)
      return { message: open, next, generation, result: completion.onComplete(open.id) }
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
 * stays where the completion left them. Moving on, with K, J, a row or a
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

/** K opens the next message, J the previous one, E completes and / searches. */
function useShortcuts(root: Root, state: PageState, complete: () => void, searchId: string) {
  useWorkbenchShortcuts(
    {
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
    },
    queueRow,
  )
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

type PageRailProps = Readonly<
  { state: PageState; canComplete: boolean } & Pick<PageInput, 'workflows' | 'mailboxes'>
>

/** The rail with the applied filters, counts and the shortcut legend. */
function PageRail({ state, canComplete, workflows, mailboxes }: PageRailProps) {
  return (
    <Sidebar
      label="Filters"
      groups={railGroups({ messages: state.messages, filter: state.filter, workflows, mailboxes })}
      onSelect={(groupId, itemId) => {
        state.filterBy({ [groupId]: itemId })
      }}
      shortcuts={
        canComplete ? shortcutLegend : shortcutLegend.filter((item) => item.label !== 'Complete')
      }
    />
  )
}

type PaneProps = Readonly<{ state: PageState; title: string }>

type QueueProps = PaneProps & Pick<PageInput, 'mailboxes'>

/** The queue, headed by the workflow and the applied mailbox filter. */
function Queue({ state, title, mailboxes }: QueueProps) {
  const count = state.shown.length
  return (
    <MessageQueue
      header={{
        title,
        headingLevel: 1,
        count: `${String(count)} ${count === 1 ? 'result' : 'results'}`,
        context: mailboxLabel(state.filter.mailbox, mailboxes),
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

type ReaderBodyProps = Readonly<{ body: BodyState; retry: () => void }>

/** The open message's body, or why it isn't there (yet). */
function ReaderBody({ body, retry }: ReaderBodyProps) {
  if (body.status === 'ready') {
    return formatMessageBody(body.text)
  }
  if (body.status !== 'error') return <p>Loading message…</p>
  if (body.reason === 'missing') {
    return (
      <EmptyState
        headingLevel={3}
        title="No text to show"
        description="This message has no plain-text body."
      />
    )
  }
  return (
    <DisconnectedState
      headingLevel={3}
      title="This message didn't load"
      action={{ label: 'Try again', onClick: retry }}
    >
      The list still works. Try again, or open another message.
    </DisconnectedState>
  )
}

type ReaderActions = ComponentProps<typeof MessageReader>['actions']

/** Complete when the page may offer it; read-only says so instead. */
function readerActions(complete: (() => void) | undefined): ReaderActions {
  return complete
    ? { primaryAction: { label: 'Complete', icon: 'check', shortcut: 'E', onClick: complete } }
    : { note: { title: 'Read only', detail: 'Nothing here changes your mail.' } }
}

type ReaderProps = PaneProps &
  ReaderBodyProps &
  Readonly<{
    /** Left out when the page is read-only. */
    complete: (() => void) | undefined
  }>

function Reader({ state, title, complete, body, retry }: ReaderProps) {
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
      actions={readerActions(complete)}
    >
      <ReaderBody body={body} retry={retry} />
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
  const { body, retry } = useMessageBody(props.loadBody, state.open?.id)
  return { state, searchId, root, notice, complete, body, retry } as const
}

/**
 * The triage workbench: the Compact workbench template filled with the rail,
 * search, queue and reader, and the state that ties them together.
 *
 * The page owns the UI state: the workflow and mailbox filters, the search,
 * which message is open, the mobile pane, focus on pane switches, and the
 * K (next), J (previous), E and / shortcuts shown in the rail and search
 * field. The keys do nothing on a field, button, checkbox or link, except
 * the queue's rows, nor with Ctrl, Alt or Cmd. It also owns the
 * Completed notice with its optional Undo. The caller owns the data: it
 * passes the messages without bodies, a loader for one body at a time, and
 * decides whether Complete is offered and what it and Undo do. The page
 * asks only for the open message's body, shows its loading, missing and
 * failed states, and changes no mail. Give it a bounded parent such as a
 * `100dvh` root.
 *
 * @example
 * import { WorkbenchPage } from '../components/pages/WorkbenchPage/WorkbenchPage'
 *
 * <div style={{ height: '100dvh' }}>
 *   <WorkbenchPage
 *     messages={messages}
 *     loadBody={(id, { signal }) => fetchBody(id, signal)}
 *     completion={{ mode: 'read-only' }}
 *     workflows={[{ id: 'review', icon: 'clock', label: 'Needs review' }]}
 *     mailboxes={[{ id: 'studio', account: 'studio', label: 'Studio Noord' }]}
 *     topBar={{ syncStatus: 'connected', syncLabel: 'Updated 2 min ago', onSyncClick, profileLabel: 'Profile Wesley Smits', profileInitials: 'WS' }}
 *   />
 * </div>
 */
export function WorkbenchPage(props: WorkbenchPageProps) {
  const { workflows, mailboxes, completion } = props
  const { state, searchId, root, notice, complete, body, retry } = useWorkbench(props)
  const title = workflows.find((item) => item.id === state.filter.workflow)?.label ?? ''
  const canComplete = completion.mode === 'enabled'
  return (
    <div ref={root} className="workbench-page">
      <WorkbenchTemplate
        mobilePane={state.pane}
        topBar={<PageTopBar topBar={props.topBar} state={state} searchId={searchId} root={root} />}
        sidebar={
          <PageRail
            state={state}
            canComplete={canComplete}
            workflows={workflows}
            mailboxes={mailboxes}
          />
        }
        queue={<Queue state={state} title={title} mailboxes={mailboxes} />}
        reader={
          <Reader
            state={state}
            title={title}
            complete={canComplete ? complete : undefined}
            body={body}
            retry={retry}
          />
        }
      />
      {completion.mode === 'enabled' && (
        <CompletedNotice
          notice={notice}
          state={state}
          note={completion.note}
          onUndoComplete={completion.onUndoComplete}
        />
      )}
    </div>
  )
}
