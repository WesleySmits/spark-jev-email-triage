import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
  type RefObject,
} from 'react'
import type { RowReview } from '../../../app/desk-review'
import type {
  DoneApprovalResult,
  DoneExecutionRequest,
  DoneExecutionResult,
} from '../../../app/done-action'
import type { MailboxActionProposal } from '../../../domain/mailbox-action'
import type { BodyLoader } from '../../../app/inbox'
import type { InboxDiscoveryScope } from '../../../app/live-inbox'
import { sameSubject } from '../../../domain/review'
import type { DeskReviewRequest } from '../../../app/desk-review'
import type { StoredClassification } from '../../../domain/stored-classification'
import type { Attention, TallyCoverage } from '../../../domain/attention'
import { Checkbox } from '../../atoms/Checkbox/Checkbox'
import { IconButton } from '../../atoms/IconButton/IconButton'
import { ClassificationEvidence } from '../../molecules/ClassificationEvidence/ClassificationEvidence'
import { DisconnectedState } from '../../molecules/DisconnectedState/DisconnectedState'
import { EmptyState } from '../../molecules/EmptyState/EmptyState'
import { LocalStatusToast } from '../../molecules/LocalStatusToast/LocalStatusToast'
import { DiscoveryStatus } from '../../molecules/DiscoveryStatus/DiscoveryStatus'
import { TriageRunControl } from '../../molecules/TriageRunControl/TriageRunControl'
import { FilterSheet } from '../../organisms/FilterSheet/FilterSheet'
import { MessageQueue } from '../../organisms/MessageQueue/MessageQueue'
import { MailboxReach, type MailboxReachProps } from '../../organisms/MailboxReach/MailboxReach'
import { MessageReader } from '../../organisms/MessageReader/MessageReader'
import { formatMessageBody } from '../../organisms/MessageReader/formatMessageBody'
import { Sidebar, type SidebarItem } from '../../organisms/Sidebar/Sidebar'
import { TopBar } from '../../organisms/TopBar/TopBar'
import {
  compactOnly,
  compactQuery,
  WorkbenchTemplate,
} from '../../templates/WorkbenchTemplate/WorkbenchTemplate'
import { ActionProposalAction } from './ActionProposalAction'
import { observationIn, proposableIn, threadReadIn, type LabelOf } from './action'
import { idleBody, type BodyState } from './body'
import {
  classificationView,
  evidenceIn,
  judgedText,
  rowState,
  type Evidence,
  type ListedEvidence,
  type RecordedReviews,
} from './classification'
import { ReviewAction, type CheckReview, type SaveReview } from './ReviewAction'
import {
  attentionReason,
  attentionTitle,
  groupByAttention,
  nextGroupStart,
  orderByAttention,
  rowAttention,
} from './attention'
import { reviewableIn } from './review'
import { emptyScopeText, scopeText, type QueueScope } from './scope'
import { useMessageBody } from './useMessageBody'
import { useShortcutPreference } from './useShortcutPreference'
import { legendFor, useWorkbenchShortcuts } from './useWorkbenchShortcuts'
import {
  afterRemoval,
  allMailboxes,
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
 * and never shows the Completed notice. The separate guarded Done panel is
 * configured through `proposals`.
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

/**
 * Whether the open message's classification may be reviewed. `off` shows no
 * review panel at all, which is what a page that has nowhere to record one
 * does.
 */
type WorkbenchReview =
  | Readonly<{ mode: 'off' }>
  | Readonly<{
      /**
       * Records one review of the classification the reader is showing. It is
       * given the exact version that was shown, and reports what became of it
       * rather than rejecting. It must change no mail: a review decides
       * labels, and the page says so in every state.
       */
      mode: 'enabled'
      onSaveReview: SaveReview
      onCheckReview: CheckReview
    }>

/**
 * Whether the open message offers a mailbox action to propose. `off` shows
 * no panel at all, which is what a page with nothing to propose against does.
 *
 * The optional callbacks take approval and execution through the server.
 * Without them, Storybook can render a proposal-only panel.
 */
type WorkbenchProposals =
  | Readonly<{ mode: 'off' }>
  | Readonly<{
      mode: 'enabled'
      /** How this computer names the person approving. Never a mailbox address. */
      approver: string
      onApprove?: ((proposal: MailboxActionProposal) => Promise<DoneApprovalResult>) | undefined
      onExecute?: ((request: DoneExecutionRequest) => Promise<DoneExecutionResult>) | undefined
      onConfirmed?: (() => void) | undefined
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
   * messages carry. A loaded-mailboxes filter is added in front; counts are
   * filled in. Only loaded mailboxes are filters: the list is not every
   * mailbox that exists.
   */
  mailboxes: readonly SidebarItem[]
  /** Variant C's mailbox reach replaces the duplicate mailbox navigation group. */
  mailboxReach?: Omit<MailboxReachProps, 'allLabel' | 'selectedId' | 'onSelect'> | undefined
  /**
   * What the page actually holds: the loaded mailboxes and counts, the
   * bounds that may have cut them, and when they were last read. It is
   * shown under the queue title, so a bounded reading never reads as a whole
   * mailbox. Left out, e.g. for fixtures, the header says nothing about
   * reach and the page claims none.
   */
  scope?: QueueScope | undefined
  /** Optional controls inside the queue header, below the loaded scope. */
  queueControls?: ReactNode
  /** Explicit bounded Jev run control, inside the existing queue header. */
  triage?: ComponentProps<typeof TriageRunControl> | undefined
  /** Controlled sender/subject discovery beyond the rows initially loaded. */
  discovery?:
    | Readonly<{
        scope?: InboxDiscoveryScope | undefined
        error?: string | undefined
        loading: boolean
        /** Changes when a new base reading should clear the submitted query. */
        resetKey: string
        onSearch: (query: string) => void
        onContinue: () => void
        onClear: () => void
      }>
    | undefined
  /**
   * What triage stored about the rows of one reading, and which reading that
   * was. A row with an entry shows that state instead of its own status and,
   * once open, the evidence behind it; a row without one keeps the status it
   * came with. Nothing here classifies: the caller passes what was stored,
   * and only the open row's own body may carry a stronger reading of it.
   *
   * Every reading needs its own `reading` id, a refresh included. A body read
   * under an earlier reading no longer proves a judgment current, because a
   * later reading may list mail the provider changed since and nothing here
   * reads a thread again. Passing the same id for two readings would claim a
   * currency this page cannot stand behind.
   */
  classifications?: ListedEvidence | undefined
  /**
   * Shows the queue as a worklist: rows in attention order under one group
   * per attention state, each row with a line saying who placed it there and
   * on what, and each group counting its rows. The attention comes from
   * `classifications` and the reviews it carries; a row it says nothing
   * about is grouped as not triaged. `coverage` is what the app proved about
   * the reading, so a count says whether it is of loaded rows or of every
   * message the view holds. Left out: the queue is the flat list it was.
   */
  worklist?: Readonly<{ coverage?: TallyCoverage | undefined }> | undefined
  /** Whether Complete is offered, and what it does. */
  completion: WorkbenchCompletion
  /**
   * Whether the open message's classification may be confirmed or corrected,
   * and where such a review goes. Left out, or `off`: no review is offered.
   *
   * A review is only offered for a classification that still describes the
   * row, so an outdated one, a failed attempt, an untriaged row and a store
   * that could not be read all show none. Reviewing is not completing: it
   * records labels, runs no provider command and changes no mail.
   */
  review?: WorkbenchReview | undefined
  /**
   * Whether the open message offers a mailbox action to propose, and how the
   * person approving one is named. Left out, or `off`: no panel is shown.
   *
   * A proposal names the open row's own mailbox copy and no other, an
   * approval is that person's decision recorded on this page, and execution
   * is blocked: nothing here reaches a mailbox or asks anything to.
   */
  proposals?: WorkbenchProposals | undefined
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

/** The single-key shortcut preference of this browser, as the page reads it. */
type Preference = ReturnType<typeof useShortcutPreference>

const shortcutSetting = {
  label: 'Single-key shortcuts',
  /** What the current value means, so the help never only says "on" or "off". */
  note: {
    on: 'K, J, G, E and / act on their own.',
    off: 'Letters and / do nothing here. Tab, Enter and Escape still work.',
  },
} as const

const readerContent = '.workbench__reader [role="region"][tabindex]'
const currentRow = '.workbench__queue [aria-current="true"]'
const queueControl = '.workbench__queue button'
// The rows are where the list is read, so the keys still act from them.
const queueRow = '.workbench__queue .message-row__button'

/** The attention of one row, by its id, as the worklist places it. */
type AttentionOf = (id: string) => Attention

type PageInput = Pick<
  WorkbenchPageProps,
  'messages' | 'workflows' | 'mailboxes' | 'completion' | 'discovery'
>

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
function usePageState(
  { messages, workflows, mailboxes, completion, discovery }: PageInput,
  attentionOf: AttentionOf | undefined,
) {
  const [chosen, setChosen] = useState(() => ({
    ...defaultFilter,
    queryResetKey: discovery?.resetKey,
  }))
  const [openId, setOpenId] = useState<string>()
  const [pane, setPane] = useState<Pane>('queue')
  // Whether the worklist is grouped by attention, or flat in the caller's
  // newest-first order. Only a worklist can be grouped.
  const [groupedChoice, setGrouped] = useState(true)
  const grouped = attentionOf !== undefined && groupedChoice
  const [generation, setGeneration] = useState(0)
  const moveOn = () => {
    setGeneration((current) => current + 1)
  }
  const { live, markPending, release } = usePendingCompletion(messages)
  const filter = appliedFilter(
    {
      ...chosen,
      query: chosen.queryResetKey === discovery?.resetKey ? chosen.query : '',
    },
    workflows,
    mailboxes,
  )
  const kept = visibleMessages(live, filter)
  // A worklist orders by attention first; the rows keep the caller's order
  // within a group, and every step, neighbour and position follows it.
  const shown = grouped ? orderByAttention(kept, attentionOf) : kept
  const open = openedMessage(shown, openId)
  // With nothing to read, the reader can't be the mobile pane, now or later.
  if (!open && pane === 'reader') setPane('queue')
  const filterBy = (change: Partial<WorkbenchFilter>) => {
    setChosen({ ...filter, ...change, queryResetKey: discovery?.resetKey })
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
    grouped,
    /** Groups the worklist by attention, or flattens it to newest first. */
    setGrouped,
    /** Opens the first row of the next group. Ungrouped, or at the last group, nothing. */
    stepGroup: () => {
      if (!grouped) return
      const next = nextGroupStart(shown, open?.id, attentionOf)
      if (next === undefined) return
      setOpenId(next)
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

/**
 * The reviews recorded from this page, by row, so the queue and the reader
 * show what was just decided without the mailbox being listed again.
 *
 * Only a save the store recorded is kept, and only the answer the store gave
 * for it: nothing here invents a reviewer or a time, and a refusal or a
 * failure or unknown result records nothing here. What is kept stops applying on its own once
 * a row no longer shows the version it named, so none of it has to be thrown
 * away by hand.
 */
function useRecordedReviews(review: WorkbenchReview | undefined) {
  const [recorded, setRecorded] = useState<RecordedReviews>({})
  // An unknown write remains blocked when its row is closed and reopened.
  const uncertain = useRef(new Map<string, DeskReviewRequest>())
  if (review?.mode !== 'enabled') return { recorded, save: undefined, resolve: undefined } as const
  const { onSaveReview } = review
  return {
    recorded,
    resolve: (id: string) => {
      uncertain.current.delete(id)
    },
    /** Saves one review of the row `id`, and keeps what the store answered. */
    save:
      (id: string): SaveReview =>
      async (request) => {
        const previous = uncertain.current.get(id)
        if (
          previous !== undefined &&
          sameSubject(previous.classification, request.classification) &&
          previous.requestId !== request.requestId
        ) {
          return { status: 'unknown' }
        }
        let outcome: Awaited<ReturnType<SaveReview>>
        try {
          outcome = await onSaveReview(request)
        } catch {
          outcome = { status: 'unknown' }
        }
        if (outcome.status === 'unknown') {
          uncertain.current.set(id, request)
          return outcome
        }
        uncertain.current.delete(id)
        if (outcome.status !== 'recorded') return outcome
        const stored = outcome.review
        if (stored !== undefined) {
          setRecorded((current) => ({
            ...current,
            [id]: { subject: request.classification, review: stored },
          }))
        }
        return outcome
      },
  } as const
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

type ShortcutsInput = Readonly<{
  root: Root
  state: PageState
  complete: () => void
  searchId: string
  /** Whether the user left the single-key shortcuts on. */
  singleKeys: boolean
}>

/**
 * K opens the next message, J the previous one, E completes and / searches,
 * while the user leaves them on. Turned off, the page listens for no key of
 * one character and says so wherever it named one.
 */
function useShortcuts({ root, state, complete, searchId, singleKeys }: ShortcutsInput) {
  useWorkbenchShortcuts(
    {
      next: () => {
        state.step(1)
      },
      previous: () => {
        state.step(-1)
      },
      group: () => {
        state.stepGroup()
      },
      // Only what the user can see: on mobile the queue hides the reader.
      complete: () => {
        if (root.current?.querySelector('.workbench__reader')?.checkVisibility()) complete()
      },
      search: () => {
        document.getElementById(searchId)?.focus()
      },
    },
    { actsFrom: queueRow, singleKeys },
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
  discovery: WorkbenchPageProps['discovery']
  searchScope?: string | undefined
  state: PageState
  searchId: string
  root: Root
  /** The `/` hint shows only while the key does something. */
  singleKeys: boolean
  /** The filters button, shown where the rail is hidden. */
  filters: ReactNode
}>

/** The top bar with the page's search. Enter moves focus to the results. */
function PageTopBar({
  topBar,
  discovery,
  searchScope,
  state,
  searchId,
  root,
  singleKeys,
  filters,
}: PageTopBarProps) {
  return (
    <TopBar
      {...topBar}
      filters={filters}
      searchId={searchId}
      searchShortcut={singleKeys}
      searchLabel={
        discovery ? 'Search sender and subject' : `Search loaded ${searchScope ?? 'mail'}`
      }
      searchPlaceholder={
        discovery ? 'Search sender + subject' : `Search loaded ${searchScope ?? 'mail'}`
      }
      searchValue={state.filter.query}
      onSearchChange={(query) => {
        state.filterBy({ query })
        if (query.trim() === '') discovery?.onClear()
      }}
      onSearchSubmit={(query) => {
        if (discovery && query.trim() !== '') {
          discovery.onSearch(query.trim())
          return
        }
        if (root.current) focusInto(root.current, 'queue', false)
      }}
    />
  )
}

type PageRailProps = Readonly<
  {
    state: PageState
    canComplete: boolean
    /** The preference: which keys the legend lists, and what the box shows. */
    shortcuts: Preference
    /** Called after a choice, e.g. to close the compact filter sheet. */
    onChoose: () => void
  } & Pick<PageInput, 'workflows' | 'mailboxes'> &
    Pick<WorkbenchPageProps, 'mailboxReach'> & { canGroup: boolean }
>

/**
 * The filters with their counts and the shortcut legend. The rail and the
 * compact sheet use this same component and filter state.
 */
function PageRail({
  state,
  canComplete,
  canGroup,
  shortcuts,
  workflows,
  mailboxes,
  mailboxReach,
  onChoose,
}: PageRailProps) {
  const groups = railGroups({
    messages: state.messages,
    filter: state.filter,
    workflows,
    mailboxes,
  })
  return (
    <Sidebar
      label="Filters"
      groups={mailboxReach ? groups.filter((group) => group.id !== 'mailbox') : groups}
      onSelect={(groupId, itemId) => {
        state.filterBy({ [groupId]: itemId })
        onChoose()
      }}
      afterGroups={
        mailboxReach && (
          <MailboxReach
            {...mailboxReach}
            allLabel="All readable mailboxes"
            selectedId={state.filter.mailbox === allMailboxes ? null : state.filter.mailbox}
            onSelect={(id) => {
              state.filterBy({ mailbox: id ?? allMailboxes })
              onChoose()
            }}
          />
        )
      }
      shortcuts={legendFor({ singleKeys: shortcuts.on, canComplete, canGroup })}
      shortcutSetting={{
        label: shortcutSetting.label,
        on: shortcuts.on,
        note: shortcuts.on ? shortcutSetting.note.on : shortcutSetting.note.off,
        onChange: shortcuts.choose,
      }}
    />
  )
}

/**
 * Whether the compact filter sheet is open. It closes once the rail is back,
 * so widening the window never leaves a modal panel over the filters it
 * stands in for, and the button that opened it is never left hidden with
 * focus to return to.
 */
function useFilterSheet() {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!open) return
    const compact = window.matchMedia(compactQuery)
    const closeWhenWide = () => {
      if (!compact.matches) setOpen(false)
    }
    closeWhenWide()
    compact.addEventListener('change', closeWhenWide)
    return () => {
      compact.removeEventListener('change', closeWhenWide)
    }
  }, [open])
  return {
    open,
    show: () => {
      setOpen(true)
    },
    close: () => {
      setOpen(false)
    },
  } as const
}

type Sheet = ReturnType<typeof useFilterSheet>

/**
 * The button that opens the filter sheet. It shows only where the rail is
 * hidden; above that width the template takes it out of the layout and the
 * tab order, because the rail is right there.
 */
function FiltersButton({ sheet }: Readonly<{ sheet: Sheet }>) {
  return (
    <IconButton
      className={compactOnly}
      icon="filter"
      label="Filters"
      aria-haspopup="dialog"
      aria-expanded={sheet.open}
      onClick={sheet.show}
    />
  )
}

type PaneProps = Readonly<{ state: PageState; title: string }>

/** What the worklist groups count, and how it names rows: left out for a flat queue. */
type Worklist = Readonly<{
  attentionOf: AttentionOf
  coverage: TallyCoverage | undefined
}>

type QueueProps = PaneProps &
  Pick<PageInput, 'mailboxes'> &
  Readonly<{
    evidence: Evidence
    scope: QueueScope | undefined
    discovery: boolean
    worklist: Worklist | undefined
    controls?: ReactNode
  }>

/**
 * The worklist's groups, counting the rows the queue shows. A mailbox filter
 * or a search narrows the rows, so its counts say they are of the filter
 * and never claim the reading's reach.
 */
function queueGroups(
  state: PageState,
  worklist: Worklist,
  scope: QueueScope | undefined,
  rows: readonly ReturnType<typeof queueRows>[number][],
) {
  const filtered = state.filter.mailbox !== allMailboxes || state.filter.query.trim() !== ''
  const groups = groupByAttention(state.shown, worklist.attentionOf, {
    coverage: worklist.coverage,
    filtered,
    view: searchScopeFor(scope) ?? 'loaded messages',
  })
  const byId = new Map(rows.map((row) => [row.id, row]))
  return groups.map(({ state: id, title, note, messages }) => ({
    id,
    title,
    note,
    messages: messages.flatMap((message) => byId.get(message.id) ?? []),
  }))
}

/**
 * The queue, headed by the workflow, the applied mailbox filter and what the
 * reading holds. The count is of loaded rows the filter kept, never of a
 * mailbox, and the scope line under it says so. The queue header shows in
 * the mobile queue pane too, so that line is not desktop-only.
 */
/** The rows the queue shows, and in a worklist the groups they sit in. */
function queueContent(
  state: PageState,
  evidence: Evidence,
  scope: QueueScope | undefined,
  worklist: Worklist | undefined,
) {
  const rows = queueRows(state.shown, evidence, worklist?.attentionOf)
  if (worklist === undefined || !state.grouped) return { rows, groups: undefined }
  return { rows, groups: queueGroups(state, worklist, scope, rows) }
}

function Queue({
  state,
  title,
  mailboxes,
  evidence,
  scope,
  discovery,
  worklist,
  controls,
}: QueueProps) {
  const count = state.shown.length
  const { rows, groups } = queueContent(state, evidence, scope, worklist)
  const setting = worklist && (
    <div className="workbench__worklist-setting">
      <Checkbox
        label="Group by attention"
        checked={state.grouped}
        onChange={(event) => {
          state.setGrouped(event.target.checked)
        }}
      />
    </div>
  )
  // Nothing loaded is not a filter that matched nothing, so Reset is offered
  // only where resetting could bring a row back.
  const nothingLoaded = scope?.loaded === 0
  return (
    <MessageQueue
      header={{
        title,
        headingLevel: 1,
        count: `${String(count)} ${count === 1 ? 'result' : 'results'}`,
        context: mailboxLabel(state.filter.mailbox, mailboxes),
        ...(scope && { scope: scopeText(scope, discovery) }),
        controls: (
          <>
            {setting}
            {controls}
          </>
        ),
      }}
      messages={rows}
      groups={groups}
      currentId={state.open?.id}
      onOpen={state.openMessage}
      empty={
        <EmptyState
          icon="inbox"
          {...(discovery && !scope
            ? {
                title: 'No search matches',
                description:
                  'No listed sender or subject matched in the scanned mailbox copies. Search further when more pages are available.',
              }
            : emptyScopeText(scope))}
          action={nothingLoaded ? undefined : { label: 'Reset filters', onClick: state.reset }}
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

/**
 * The rows as the queue shows them: a stored state replaces the row's own
 * status, where a person decided the category, theirs is the one shown, and
 * in a worklist every row says why it sits where it does.
 */
function queueRows(
  messages: readonly WorkbenchMessage[],
  evidence: Evidence,
  attentionOf: AttentionOf | undefined,
) {
  return messages.map((message) => {
    const found = evidence.of(message.id)
    const shown =
      found === undefined
        ? message
        : { ...message, ...rowState(found, evidence.reviewOf(message.id)) }
    return attentionOf === undefined
      ? shown
      : { ...shown, reason: attentionReason(attentionOf(message.id)) }
  })
}

/** The evidence strip under the reader header, or none when nothing is known. */
function readerEvidence(
  classification: StoredClassification | undefined,
  review: RowReview | undefined,
  attention: Attention | undefined,
) {
  if (classification === undefined) return undefined
  const { state, detail, facts, note, judgedAt } = classificationView(classification, review)
  // The worklist's own answer first: where the row sits and why, in the
  // same words the queue uses, so the reader never says something else.
  const placed =
    attention === undefined
      ? []
      : [{ term: 'Attention', value: attentionTitle(attention), note: attentionReason(attention) }]
  return (
    <ClassificationEvidence
      title="Jev triage"
      state={state}
      detail={detail}
      facts={[...placed, ...facts]}
      note={note}
      judged={
        judgedAt === undefined
          ? undefined
          : { label: 'Judged', text: judgedText(judgedAt), dateTime: judgedAt }
      }
    />
  )
}

/**
 * The review panel under the body, or none. It is offered only where there
 * is somewhere to record a review and something that still describes the row
 * to review; `reviewableIn` decides the second. The open row's id keys it, so
 * a choice made on one message never carries to the next.
 */
function readerReview(
  save: ((id: string) => SaveReview) | undefined,
  resolve: ((id: string) => void) | undefined,
  check: CheckReview | undefined,
  evidence: Evidence,
  openId: string | undefined,
) {
  if (save === undefined || resolve === undefined || check === undefined || openId === undefined) {
    return undefined
  }
  const reviewable = reviewableIn(evidence.open)
  if (reviewable === undefined) return undefined
  return (
    <ReviewAction
      key={openId}
      reviewable={reviewable}
      saved={evidence.openReview}
      onSave={save(openId)}
      onCheck={check}
      onResolved={() => {
        resolve(openId)
      }}
    />
  )
}

/**
 * The mailbox action panel under the review, or none. It is offered for the
 * open row wherever the page may propose at all, including where that row
 * names no version to propose against: proposing is then refused in words
 * rather than silently absent.
 *
 * The open row's id keys it, so one message's proposal never carries to the
 * next, while a reading that lists the mailbox again leaves it in place. A
 * proposal must be seen to lapse when a later message reaches its thread,
 * which is exactly what an unchanged panel under a changed reading shows.
 */
function readerProposal(
  proposals: WorkbenchProposals | undefined,
  evidence: Evidence,
  open: WorkbenchMessage | undefined,
  listed: ListedEvidence | undefined,
  body: BodyState,
  labelOf: LabelOf,
) {
  if (proposals?.mode !== 'enabled' || open === undefined) return undefined
  const read = threadReadIn(open, listed, body)
  return (
    <ActionProposalAction
      key={open.id}
      proposable={proposableIn(evidence.open, read)}
      observation={observationIn(evidence.open, read)}
      approver={proposals.approver}
      labelOf={labelOf}
      onApprove={proposals.onApprove}
      onExecute={proposals.onExecute}
      onConfirmed={proposals.onConfirmed}
    />
  )
}

/**
 * How a mailbox copy is named in the action panel: as the rail names its
 * mailbox, never as an address the page would otherwise not show. A mailbox
 * none of the listed rows came from is named as such rather than guessed at.
 */
function mailboxNames(messages: readonly WorkbenchMessage[]): LabelOf {
  const labels = new Map(messages.map((message) => [message.mailbox, message.account.label]))
  return ({ mailboxId }) => labels.get(mailboxId) ?? 'Another mailbox'
}

type ReaderActions = ComponentProps<typeof MessageReader>['actions']

/**
 * Complete when the page may offer it. The E hint shows only while its key
 * acts; guarded Done remains a separate proposal.
 */
function readerActions(
  complete: (() => void) | undefined,
  singleKeys: boolean,
  guardedDone: boolean,
): ReaderActions {
  if (complete) {
    return {
      primaryAction: {
        label: 'Complete',
        icon: 'check',
        ...(singleKeys && { shortcut: 'E' }),
        onClick: complete,
      },
    }
  }
  if (guardedDone) {
    return {
      note: {
        title: 'Guarded Done',
        detail: 'Use the proposal panel below to approve and run Spark Done.',
      },
    }
  }
  return { note: { title: 'Read only', detail: 'Nothing here changes your mail.' } }
}

type ReaderProps = PaneProps &
  ReaderBodyProps &
  Readonly<{
    /** Left out when the page is read-only. */
    complete: (() => void) | undefined
    /** What is known about the open row's triage. Left out to show none. */
    evidence: StoredClassification | undefined
    /** What a person decided about it, where anyone has. */
    reviewed: RowReview | undefined
    /** Where the worklist places the open row, or none for a flat queue. */
    attention: Attention | undefined
    /** The review panel for the open row, or none when it offers no review. */
    review: ReactNode
    /** The mailbox action panel for the open row, or none when none is offered. */
    proposal: ReactNode
    guardedDone?: boolean | undefined
    /** Whether the single-key shortcuts are on, which the E hint follows. */
    singleKeys: boolean
  }>

function Reader({
  state,
  title,
  complete,
  body,
  retry,
  evidence,
  reviewed,
  attention,
  review,
  proposal,
  guardedDone = false,
  singleKeys,
}: ReaderProps) {
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
  const place = `${String(shown.indexOf(open) + 1)} of ${String(shown.length)} in ${title}`
  const position = attention === undefined ? place : `${place} · ${attentionTitle(attention)}`
  return (
    <MessageReader
      key={open.id}
      mobileBar={{ title: open.account.label, context: position, onBack: state.back }}
      header={{
        subject: open.subject,
        // The evidence strip carries the state when there is one, so the
        // header never says something else beside it.
        ...(evidence === undefined && { status: open.status }),
        sender: {
          name: open.sender,
          initials: initials(open.sender),
          address: open.address,
          account: open.account,
          time: open.time,
          dateTime: open.dateTime,
        },
      }}
      evidence={readerEvidence(evidence, reviewed, attention)}
      review={review}
      proposal={proposal}
      actions={readerActions(complete, singleKeys, guardedDone)}
    >
      <ReaderBody body={body} retry={retry} />
    </MessageReader>
  )
}

/** Everything the page ties together: state, focus, the notice and the keys. */
/**
 * The worklist the page shows, or none. What the reading listed about every
 * row, and what was decided since, places the rows before any is open: the
 * worklist's order must not wait for a body, and a body read never moves a
 * row between groups.
 */
function worklistFor(
  props: Pick<WorkbenchPageProps, 'classifications' | 'worklist'>,
  recorded: RecordedReviews,
): Worklist | undefined {
  if (props.worklist === undefined) return undefined
  const listed = evidenceIn(props.classifications, undefined, idleBody, recorded)
  return {
    attentionOf: (id) => rowAttention(listed.of(id), listed.reviewOf(id)),
    coverage: props.worklist.coverage,
  }
}

/** Where the worklist places the open row, or nothing without either. */
function openAttentionIn(worklist: Worklist | undefined, open: WorkbenchMessage | undefined) {
  if (worklist === undefined || open === undefined) return undefined
  return worklist.attentionOf(open.id)
}

function useWorkbench(props: WorkbenchPageProps) {
  const reviews = useRecordedReviews(props.review)
  const worklist = worklistFor(props, reviews.recorded)
  const state = usePageState(props, worklist?.attentionOf)
  const searchId = useId()
  const root = useRef<HTMLDivElement>(null)
  const restoreRef = useRef<Place | null>(null)
  const notice = useCompletedNotice(state, restoreRef)
  const complete = useComplete(state, notice, restoreRef)
  const shortcuts = useShortcutPreference()
  useShortcuts({ root, state, complete, searchId, singleKeys: shortcuts.on })
  useKeepFocus(root, restoreRef, state, notice.message !== undefined)
  useFollowCurrentRow(root, state.open?.id)
  const { body, retry } = useMessageBody(
    props.loadBody,
    state.open?.id,
    props.classifications?.reading,
  )
  const evidence = evidenceIn(props.classifications, state.open?.id, body, reviews.recorded)
  return {
    state,
    searchId,
    root,
    notice,
    complete,
    body,
    retry,
    evidence,
    reviews,
    shortcuts,
    worklist,
    openAttention: openAttentionIn(worklist, state.open),
  } as const
}

function queueTitle(
  scope: QueueScope | undefined,
  workflows: readonly SidebarItem[],
  workflow: string,
) {
  if (scope?.view === 'unread') return 'Unread'
  if (scope?.view === 'other') return 'Other Inbox'
  return workflows.find((item) => item.id === workflow)?.label ?? ''
}

function searchScopeFor(scope: QueueScope | undefined) {
  if (scope?.view === 'unread') return 'unread messages'
  if (scope?.view === 'other') return 'other Inbox messages'
  return undefined
}

/**
 * The triage workbench: the Compact workbench template filled with the rail,
 * search, queue and reader, and the state that ties them together.
 *
 * The page owns the UI state: the workflow and mailbox filters, the search,
 * which message is open, the mobile pane, focus on pane switches, and the
 * K (next), J (previous), E and / shortcuts shown in the rail and search
 * field. The keys do nothing on a field, button, checkbox or link, except
 * the queue's rows, nor with Ctrl, Alt or Cmd. The rail's Single-key
 * shortcuts box turns them off for this browser: then no key of one
 * character acts, nothing claims one, and Tab, Enter and Escape are all the
 * page needs. That choice is kept in local storage, without any mail, and
 * the rail opens in the Filters sheet at narrow widths. It also owns
 * the Completed notice with its optional Undo. The caller owns the data: it
 * passes the messages without bodies, a loader for one body at a time, and
 * decides whether Complete is offered and what it and Undo do. The page
 * asks only for the open message's body, shows its loading, missing and
 * failed states, and changes no mail. Give it a bounded parent such as a
 * `100dvh` root.
 *
 * Where the layout hides the rail, the same filters are one button away in
 * the top bar: it opens a modal sheet holding that very rail, so there is one
 * filter model and one set of counts at every width. Choosing there applies
 * the filter, closes the sheet and shows the queue; the open message, the
 * back navigation and the search stay as they were. Escape, the close button
 * and the backdrop close it, and focus returns to the button that opened it.
 *
 * Passing `classifications` shows what triage stored about each row: a state
 * badge and category on the row, and the evidence behind it under the reader
 * header. The page reads no store and calls no classifier; the open row's
 * body may carry a stronger reading of what the caller listed, and only that
 * can say a judgment is current. That reading is scoped to the reading it
 * ran under: passing a new one, as a refresh does, drops back to what the
 * store alone says without asking for anything again.
 *
 * Passing `proposals` offers the open message a guarded Spark Done action.
 * Its proposal, server-owned approval and execution outcome remain separate
 * stages. The selected mailbox copy provides context; Spark acts by ID.
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
  const {
    state,
    searchId,
    root,
    notice,
    complete,
    body,
    retry,
    evidence,
    reviews,
    shortcuts,
    worklist,
    openAttention,
  } = useWorkbench(props)
  const sheet = useFilterSheet()
  const title = props.discovery?.scope
    ? `“${props.discovery.scope.query}”`
    : queueTitle(props.scope, workflows, state.filter.workflow)
  const canComplete = completion.mode === 'enabled'
  const closeSheet = () => {
    sheet.close()
    if (window.matchMedia(compactQuery).matches) return
    const rail = root.current?.querySelector<HTMLElement>('.workbench__sidebar')
    const active = rail?.querySelector<HTMLElement>('button[aria-pressed="true"]')
    const focusTarget = active ?? rail?.querySelector<HTMLElement>('button')
    focusTarget?.focus()
  }
  // Both places use the same filter state and rail props. Only one is
  // reachable at a given width.
  const rail = (
    <PageRail
      state={state}
      canComplete={canComplete}
      canGroup={state.grouped}
      shortcuts={shortcuts}
      workflows={workflows}
      mailboxes={mailboxes}
      mailboxReach={props.mailboxReach}
      onChoose={sheet.close}
    />
  )
  return (
    <div ref={root} className="workbench-page">
      <WorkbenchTemplate
        mobilePane={state.pane}
        topBar={
          <PageTopBar
            topBar={props.topBar}
            discovery={props.discovery}
            searchScope={searchScopeFor(props.scope)}
            state={state}
            searchId={searchId}
            root={root}
            singleKeys={shortcuts.on}
            filters={<FiltersButton sheet={sheet} />}
          />
        }
        sidebar={rail}
        filters={
          <FilterSheet label="Filters" open={sheet.open} onClose={closeSheet}>
            {rail}
          </FilterSheet>
        }
        queue={
          <Queue
            state={state}
            title={title}
            mailboxes={mailboxes}
            evidence={evidence}
            scope={props.discovery?.scope ? undefined : props.scope}
            discovery={props.discovery !== undefined}
            worklist={worklist}
            controls={
              <>
                {props.discovery && (
                  <DiscoveryStatus
                    scope={props.discovery.scope}
                    error={props.discovery.error}
                    loading={props.discovery.loading}
                    onContinue={props.discovery.onContinue}
                  />
                )}
                {props.queueControls}
                {props.triage && <TriageRunControl {...props.triage} />}
              </>
            }
          />
        }
        reader={
          <Reader
            state={state}
            title={title}
            complete={canComplete ? complete : undefined}
            body={body}
            retry={retry}
            evidence={evidence.open}
            reviewed={evidence.openReview}
            attention={openAttention}
            singleKeys={shortcuts.on}
            review={readerReview(
              reviews.save,
              reviews.resolve,
              props.review?.mode === 'enabled' ? props.review.onCheckReview : undefined,
              evidence,
              state.open?.id,
            )}
            proposal={readerProposal(
              props.proposals,
              evidence,
              state.open,
              props.classifications,
              body,
              mailboxNames(props.messages),
            )}
            guardedDone={
              props.proposals?.mode === 'enabled' && props.proposals.onExecute !== undefined
            }
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
