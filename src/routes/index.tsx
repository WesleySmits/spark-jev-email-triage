import { useEffect, useRef, useState, type RefObject } from 'react'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { EmptyState } from '../components/molecules/EmptyState/EmptyState'
import { LocalStatusToast } from '../components/molecules/LocalStatusToast/LocalStatusToast'
import { ConnectionPage } from '../components/pages/ConnectionPage/ConnectionPage'
import { connectionView } from '../components/pages/ConnectionPage/connection'
import { useReconnect } from '../components/pages/ConnectionPage/useReconnect'
import { WorkbenchPage } from '../components/pages/WorkbenchPage/WorkbenchPage'
import { syncScopeLabel } from '../components/pages/WorkbenchPage/scope'
import { InboxZeroStatusBar } from '../components/molecules/InboxZeroStatusBar/InboxZeroStatusBar'
import { InboxViewBar } from '../components/molecules/InboxViewBar/InboxViewBar'
import { useInboxReadFocus, type InboxReadFocus } from '../app/inbox-read-focus'
import {
  coverageFromInboxScope,
  readWithCoverage,
  readWithStart,
  startedAtForRequest,
} from '../app/inbox-coverage-adapter'
import { failedCoverage, inboxCoverage, type InboxCoverage } from '../app/inbox-coverage'
import { ReviewDesk, type DeskReason, type DeskView } from '../app/review-desk'
import type { DeskDiscovery, DeskRefresh } from '../app/review-desk'
import type { InboxDiscoveryRequest, InboxListRequest } from '../app/live-inbox'
import { useTriageRunController } from '../app/triage-run-client'
import { mailboxReachItems } from '../app/mailbox-reach'
import { refreshNotice } from '../app/refresh-notice'
import { mailboxReachIn, type RecordedWork } from '../app/open-work'

export const Route = createFileRoute('/')({
  // The saved work list is read beside the inbox, from the local record only,
  // so what somebody decided is there again after the app was closed.
  loader: async () => {
    const [read, work] = await Promise.all([
      readWithStart(() => ReviewDesk.open()),
      ReviewDesk.work(),
    ])
    return { ...read, work }
  },
  component: Home,
  errorComponent: Unreachable,
})

const profile = { profileLabel: 'Profile', profileInitials: 'ME' } as const
const triageGateway = {
  start: ReviewDesk.startTriage,
  restart: ReviewDesk.restartTriage,
  read: ReviewDesk.triageStatus,
  stop: ReviewDesk.stopTriage,
} as const

/** How long the Spark connected notice stays, unless focus is on it. */
const noticeMs = 8_000

type ConnectionProps = Readonly<{
  reason: DeskReason
  /** Reads the inbox once Spark answers. */
  onReady: () => Promise<void>
}>

/**
 * Waits for Spark in the workbench, checking as `app/reconnect.ts` says,
 * and reads the inbox once when it answers. Nothing here changes mail, and
 * no sample mail is ever shown.
 */
function Connection({ reason, onReady }: ConnectionProps) {
  const { state, checkNow } = useReconnect({
    reason,
    probe: (signal) => ReviewDesk.probe(signal),
    load: onReady,
  })
  return (
    <div className="app-root">
      <ConnectionPage
        connection={connectionView(state)}
        onCheckNow={checkNow}
        workflows={ReviewDesk.workflows}
        {...profile}
      />
    </div>
  )
}

function Unreachable() {
  const router = useRouter()
  return <Connection reason="unreachable" onReady={() => router.invalidate()} />
}

/** Focus the open row, or the queue's first control, when focus was lost. */
function focusQueue(root: HTMLElement | null) {
  const active = document.activeElement
  if (active && active !== document.body) return
  const target =
    root?.querySelector<HTMLElement>('.workbench__queue [aria-current="true"]') ??
    root?.querySelector<HTMLElement>('.workbench__queue button')
  target?.focus()
}

const focusInNotice = () => Boolean(document.activeElement?.closest('.local-status-toast'))

/**
 * "Spark connected", once the page waited for Spark and the inbox came.
 * The toast stays mounted, hidden, so its status region announces it when it
 * shows. On arrival, focus that the waiting page took with it goes to the
 * queue. It hides after a few seconds unless focus is on it; hiding with
 * focus on it sends focus back to the queue.
 */
function useConnectedNotice(root: RefObject<HTMLDivElement | null>, arrived: boolean) {
  const [done, setDone] = useState(false)
  const visible = arrived && !done
  useEffect(() => {
    if (!visible) return
    focusQueue(root.current)
    const timer = window.setTimeout(() => {
      if (!focusInNotice()) setDone(true)
    }, noticeMs)
    return () => {
      window.clearTimeout(timer)
    }
  }, [root, visible])
  return {
    visible,
    /** Shows it again next time, e.g. when Spark goes away and comes back. */
    reset: () => {
      setDone(false)
    },
    hide: () => {
      const hadFocus = focusInNotice()
      setDone(true)
      if (hadFocus && document.activeElement instanceof HTMLElement) {
        document.activeElement.blur()
        focusQueue(root.current)
      }
    },
  } as const
}

type PageProps = Readonly<{
  inbox: DeskView | DeskRefresh
  root: RefObject<HTMLDivElement | null>
  onReady: () => Promise<void>
  onRefresh: () => Promise<void>
  onChange: (request: InboxListRequest) => Promise<void>
  discovery: DeskDiscovery | undefined
  onSearch: (request: InboxDiscoveryRequest) => Promise<void>
  onClearSearch: () => void
  coverage: InboxCoverage | undefined
  loading: boolean
  triage: ReturnType<typeof useTriageRunController>
  /** The saved work list as last read, and how to read it again. */
  work: RecordedWork
  onWorkChanged: () => void
}>

type ReadyDesk = Extract<DeskView, { status: 'ready' }> | Extract<DeskRefresh, { status: 'ready' }>
type LoadedPageProps = Omit<PageProps, 'inbox' | 'onReady'> & Readonly<{ inbox: ReadyDesk }>

function EmptyInbox({ onRefresh, loading }: Pick<PageProps, 'onRefresh' | 'loading'>) {
  const reread = () => {
    if (!loading) void onRefresh()
  }
  return (
    <main className="app-notice">
      <EmptyState
        icon="inbox"
        title="No readable mailboxes"
        description="Spark reports no mailbox this app may read."
        action={{ label: 'Check again', onClick: reread }}
      />
    </main>
  )
}

/**
 * What the Inbox Zero scan proved about the selected view, for the worklist's
 * counts. Without a scan nothing is proved, so counts are of loaded rows.
 */
function worklistCoverage(coverage: InboxCoverage | undefined, view: InboxListRequest['view']) {
  if (coverage === undefined) return undefined
  return { result: coverage[view === 'unread' ? 'unread' : 'read'].result }
}

function LoadedPage({
  inbox,
  root,
  onRefresh,
  onChange,
  discovery,
  onSearch,
  onClearSearch,
  coverage,
  loading,
  triage,
  work,
  onWorkChanged,
}: LoadedPageProps) {
  const rememberReadFocus = useInboxReadFocus(root, loading)
  const reread = () => {
    if (!loading) void onRefresh()
  }
  const refresh = () => {
    rememberReadFocus('refresh')
    reread()
  }
  const change = (request: InboxListRequest, focus: InboxReadFocus) => {
    rememberReadFocus(focus)
    return onChange(request)
  }
  // It names what was refreshed: the loaded selection, not a whole mailbox,
  // and whether a mailbox could not be read, because Refresh is what reads
  // them all again. A reading that lost a mailbox keeps the rest, so the
  // retry is global but costs no mail that did arrive.
  const syncLabel = syncScopeLabel(inbox.scope)
  const { view } = inbox.scope
  const { shown, reach } = shownReading(inbox, discovery)
  return (
    <div ref={root} className="app-root app-root--inbox">
      <div className="inbox-view__workbench">
        <WorkbenchPage
          key={view}
          messages={shown.messages}
          classifications={{
            reading: shown.reading,
            states: shown.classifications,
            reviews: shown.reviews,
          }}
          loadBody={ReviewDesk.focus(shown)}
          workflows={ReviewDesk.workflows}
          mailboxes={shown.mailboxes}
          mailboxReach={{ items: reach, onRetry: reread }}
          scope={inbox.scope}
          worklist={{ coverage: worklistCoverage(coverage, view) }}
          discovery={discoveryProps({ inbox, discovery, loading, onSearch, onClearSearch })}
          queueControls={
            <>
              <InboxViewBar scope={inbox.scope} loading={loading} onChange={change} />
              {coverage && <InboxZeroStatusBar coverage={coverage} refreshing={loading} />}
            </>
          }
          triage={{
            worklistSize: inbox.messages.length,
            state: triage.state,
            onStart: (limits) => {
              void triage.start(limits)
            },
            onResume: () => {
              void triage.resume()
            },
            onRead: () => {
              void triage.read()
            },
            onStop: () => {
              void triage.stop()
            },
            onRestart: () => {
              void triage.restart()
            },
            onForget: triage.forget,
          }}
          completion={{ mode: 'read-only' }}
          review={{
            mode: 'enabled',
            onSaveReview: ReviewDesk.review,
            onCheckReview: async (subject) => {
              const result = await ReviewDesk.check(subject)
              if (result.status === 'recorded') reread()
              return result
            },
          }}
          proposals={{
            mode: 'enabled',
            approver: 'you, at this computer',
            onApprove: ReviewDesk.approveDone,
            onExecute: ReviewDesk.executeDone,
            onConfirmed: reread,
          }}
          work={workbenchWork(work, inbox, coverage, onWorkChanged)}
          topBar={{
            syncStatus: 'connected',
            syncLabel,
            syncActionLabel: `Refresh mail · ${syncLabel}`,
            onSyncClick: refresh,
            syncDisabled: loading,
            ...profile,
          }}
        />
      </div>
    </div>
  )
}

/**
 * What the workbench lists: a finished search's rows, else the reading's,
 * with the mailbox reach the rail shows for them.
 */
function shownReading(inbox: ReadyDesk, discovery: DeskDiscovery | undefined) {
  const shown = discovery?.status === 'ready' ? discovery : inbox
  const refreshSummary = 'refresh' in inbox ? inbox.refresh : undefined
  return { shown, reach: mailboxReachItems(shown.scope, shown.mailboxes, refreshSummary) }
}

type DiscoveryInput = Pick<
  LoadedPageProps,
  'inbox' | 'discovery' | 'loading' | 'onSearch' | 'onClearSearch'
>

/**
 * Search as the workbench takes it: the scope of a finished search, or why
 * search is unavailable while the loaded selection stays shown.
 */
function discoveryProps({ inbox, discovery, loading, onSearch, onClearSearch }: DiscoveryInput) {
  const { view } = inbox.scope
  const found = discovery?.status === 'ready' ? discovery : undefined
  return {
    scope: found?.scope,
    ...(discovery?.status === 'unavailable' && {
      error: 'Search unavailable. The loaded selection is still shown.',
    }),
    loading,
    resetKey: inbox.reading,
    onSearch: (query: string) => {
      void onSearch({ view, query })
    },
    onContinue: () => {
      if (found) void onSearch({ view, query: found.scope.query, cursor: found.scope.cursor })
    },
    onClear: onClearSearch,
  }
}

/**
 * The saved work list as the workbench takes it: the record as last read,
 * what this reading and the Inbox Zero scan prove about each mailbox, and
 * where a decision is saved. Nothing here reaches Spark.
 */
const workbenchWork = (
  recorded: RecordedWork,
  inbox: ReadyDesk,
  coverage: InboxCoverage | undefined,
  onChanged: () => void,
) => ({
  recorded,
  reachOf: mailboxReachIn(inbox.scope, coverage),
  onRecord: ReviewDesk.recordWork,
  onChanged,
})

/** The page for what the loader found: waiting, no mailboxes or the inbox. */
function Page(props: PageProps) {
  if (props.inbox.status === 'unavailable') {
    return <Connection reason={props.inbox.reason} onReady={props.onReady} />
  }
  if (props.inbox.mailboxes.length === 0) return <EmptyInbox {...props} />
  return <LoadedPage {...props} inbox={props.inbox} />
}

// Recent Spark mail and stored triage. Reviews change only the local review
// store. The separate Done panel may approve and execute one guarded Spark
// message-ID action when the server kill switch is enabled. Inbox refresh and
// body reads remain read-only and never start an action.
const initialCoverage = (initial: DeskView, startedAt: string) =>
  initial.status === 'ready'
    ? inboxCoverage(undefined, coverageFromInboxScope(initial.scope, startedAt))
    : undefined

function coverageUpdate(
  result: DeskView | DeskRefresh,
  view: InboxListRequest['view'],
  startedAt: string,
  finishedAt: string,
) {
  return result.status === 'ready'
    ? coverageFromInboxScope(result.scope, startedAt)
    : failedCoverage(view, startedAt, finishedAt)
}

function useDeskReading(initial: DeskView, initialStartedAt: string) {
  const [inbox, setInbox] = useState<DeskView | DeskRefresh>(initial)
  const [discovery, setDiscovery] = useState<DeskDiscovery>()
  const [coverage, setCoverage] = useState<InboxCoverage | undefined>(() =>
    initialCoverage(initial, initialStartedAt),
  )
  const [loading, setLoading] = useState(false)
  const request = useRef<InboxListRequest>({ view: 'unread' })
  const sequence = useRef(0)
  const read = async (next: InboxListRequest) => {
    const current = ++sequence.current
    const startedAt = startedAtForRequest(coverage, next, new Date().toISOString())
    request.current = next
    setDiscovery(undefined)
    setLoading(true)
    const result = await readWithCoverage(
      next.view,
      startedAt,
      () => ReviewDesk.open(next),
      (value, finishedAt) => coverageUpdate(value, next.view, startedAt, finishedAt),
    )
    if (current === sequence.current) {
      if (result.status === 'ready') setInbox(result.value)
      setCoverage((previous) => inboxCoverage(previous, result.update))
      setLoading(false)
    }
  }
  const refresh = async () => {
    const current = ++sequence.current
    const view = inbox.status === 'ready' ? inbox.scope.view : request.current.view
    const startedAt = new Date().toISOString()
    setDiscovery(undefined)
    setLoading(true)
    const value = await ReviewDesk.refresh({ view })
    const finishedAt = new Date().toISOString()
    if (current === sequence.current) {
      if (value.status === 'ready') setInbox(value)
      setCoverage((previous) =>
        inboxCoverage(previous, coverageUpdate(value, view, startedAt, finishedAt)),
      )
      setLoading(false)
    }
  }
  const search = async (next: InboxDiscoveryRequest) => {
    const current = ++sequence.current
    setLoading(true)
    const value = await ReviewDesk.search(next)
    if (current === sequence.current) {
      setDiscovery(value)
      setLoading(false)
    }
  }
  return {
    inbox,
    discovery,
    coverage,
    loading,
    read,
    refresh,
    search,
    clearSearch: () => {
      setDiscovery(undefined)
    },
    request,
  } as const
}

function loadedMessageSummary(inbox: DeskView | DeskRefresh) {
  const count = inbox.status === 'ready' ? inbox.messages.length : 0
  const kind = inbox.status === 'ready' && inbox.scope.view === 'other' ? 'read' : 'unread'
  return {
    count,
    label: `${String(count)} ${kind} ${count === 1 ? 'message' : 'messages'}`,
  } as const
}

/**
 * What the last Refresh proved changed, until it is dismissed. A later
 * Refresh shows its own notice again.
 */
function useRefreshedNotice(inbox: DeskView | DeskRefresh) {
  const refreshed = inbox.status === 'ready' && 'refresh' in inbox ? inbox.refresh : undefined
  const [dismissed, setDismissed] = useState<string>()
  const notice = refreshed && refreshNotice(refreshed)
  return {
    visible: Boolean(refreshed && dismissed !== refreshed.refreshedAt),
    title: notice?.title,
    detail: notice?.detail,
    onDismiss: () => {
      if (refreshed) setDismissed(refreshed.refreshedAt)
    },
  }
}

/**
 * The saved work list, read once by the loader and again on Refresh or after
 * a save the store confirmed. A newer read always wins over an older one.
 */
function useRecordedWork(initial: RecordedWork) {
  const [work, setWork] = useState(initial)
  const sequence = useRef(0)
  const reread = () => {
    const current = ++sequence.current
    void ReviewDesk.work().then((next) => {
      if (current === sequence.current) setWork(next)
    })
  }
  return { work, reread } as const
}

function Home() {
  const initialRead = Route.useLoaderData()
  const initial = initialRead.value
  const recordedWork = useRecordedWork(initialRead.work)
  const { inbox, discovery, coverage, loading, read, refresh, search, clearSearch, request } =
    useDeskReading(initial, initialRead.startedAt)
  const root = useRef<HTMLDivElement>(null)
  // Set once Spark answered after the page waited, so the inbox says so.
  const [waited, setWaited] = useState(false)
  const { count, label: messages } = loadedMessageSummary(inbox)
  const notice = useConnectedNotice(root, waited && count > 0)
  const refreshedToast = useRefreshedNotice(inbox)
  const triage = useTriageRunController({
    reading: inbox.status === 'ready' ? inbox.reading : undefined,
    gateway: triageGateway,
  })
  return (
    <>
      <Page
        inbox={inbox}
        root={root}
        onReady={() => {
          setWaited(true)
          notice.reset()
          return read({ view: request.current.view })
        }}
        onRefresh={() => {
          notice.hide()
          // Refresh checks the saved work against the new reading, so it
          // reads the record again beside the mailbox.
          recordedWork.reread()
          return refresh()
        }}
        onChange={read}
        discovery={discovery}
        onSearch={search}
        onClearSearch={clearSearch}
        coverage={coverage}
        loading={loading}
        triage={triage}
        work={recordedWork.work}
        onWorkChanged={recordedWork.reread}
      />
      <LocalStatusToast
        visible={notice.visible}
        title="Spark connected"
        detail={`${messages} loaded`}
        dismissLabel="Dismiss"
        onDismiss={notice.hide}
      />
      <LocalStatusToast {...refreshedToast} dismissLabel="Dismiss" />
    </>
  )
}
