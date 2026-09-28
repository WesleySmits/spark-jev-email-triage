import { useEffect, useRef, useState, type ComponentProps, type RefObject } from 'react'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { EmptyState } from '../components/molecules/EmptyState/EmptyState'
import { LocalStatusToast } from '../components/molecules/LocalStatusToast/LocalStatusToast'
import { ConnectionPage } from '../components/pages/ConnectionPage/ConnectionPage'
import { connectionView } from '../components/pages/ConnectionPage/connection'
import { useReconnect } from '../components/pages/ConnectionPage/useReconnect'
import { WorkbenchPage } from '../components/pages/WorkbenchPage/WorkbenchPage'
import { syncScopeLabel } from '../components/pages/WorkbenchPage/scope'
import { useInboxReadFocus } from '../app/inbox-read-focus'
import { readWithStart } from '../app/inbox-coverage-adapter'
import { ReviewDesk, type DeskReason, type DeskView } from '../app/review-desk'
import type { DeskDiscovery, DeskRefresh } from '../app/review-desk'
import type { InboxDiscoveryRequest, InboxScope } from '../app/live-inbox'
import { useTriageRunController } from '../app/triage-run-client'
import { mailboxReachItems } from '../app/mailbox-reach'
import { refreshNotice } from '../app/refresh-notice'
import type { OpenWorkRead, WorkDecisionRequest } from '../app/open-work'
import { openWorkTally, sortOpenWorkItems } from '../domain/open-work'
import { OpenWorkPage } from '../components/pages/OpenWorkPage/OpenWorkPage'

export const Route = createFileRoute('/')({
  loader: () => readWithStart(() => ReviewDesk.open()),
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
  discovery: DeskDiscovery | undefined
  onSearch: (request: InboxDiscoveryRequest) => Promise<void>
  onClearSearch: () => void
  scanning: boolean
  scanError: boolean
  loading: boolean
  triage: ReturnType<typeof useTriageRunController>
  onRecordWork: (request: WorkDecisionRequest) => ReturnType<typeof ReviewDesk.recordWork>
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
function scanComplete(scope: InboxScope, scanError = false) {
  return (
    !scanError &&
    !scope.bounded &&
    scope.failed.length === 0 &&
    (scope.incomplete?.length ?? 0) === 0 &&
    scope.mailboxes.length === scope.readable
  )
}

function continueDiscovery(
  found: Extract<DeskDiscovery, { status: 'ready' }> | undefined,
  view: InboxDiscoveryRequest['view'],
  onSearch: PageProps['onSearch'],
) {
  if (found) void onSearch({ view, query: found.scope.query, cursor: found.scope.cursor })
}

async function checkReviewAndRefresh(
  subject: Parameters<typeof ReviewDesk.check>[0],
  refresh: () => void,
) {
  const result = await ReviewDesk.check(subject)
  if (result.status === 'recorded') refresh()
  return result
}

function ScanStatus({
  scope,
  scanning,
  scanError,
}: Readonly<{ scope: InboxScope; scanning: boolean; scanError: boolean }>) {
  const failed = scope.failed.length + (scope.incomplete?.length ?? 0)
  const complete = scope.mailboxes.filter(
    (mailbox) =>
      !mailbox.bounded &&
      !scope.failed.some(({ id }) => id === mailbox.id) &&
      !scope.incomplete?.some(({ id }) => id === mailbox.id),
  ).length
  const label = scanning
    ? 'Scanning full Inbox'
    : scanComplete(scope, scanError)
      ? 'Full Inbox scanned'
      : 'Inbox scan incomplete'
  return (
    <p className="inbox-view__note" role="status">
      {label} · {String(scope.loaded)} loaded · {String(complete)}/{String(scope.readable)}{' '}
      mailboxes complete
      {failed > 0 ? ` · ${String(failed)} failed or incomplete` : ''}
      {scanning ? ' · Search covers the loaded rows until scanning finishes' : ''}
    </p>
  )
}

function discoveryFor(
  inbox: ReadyDesk,
  discovery: DeskDiscovery | undefined,
  loading: boolean,
  onSearch: PageProps['onSearch'],
  onClearSearch: PageProps['onClearSearch'],
): NonNullable<ComponentProps<typeof WorkbenchPage>['discovery']> {
  const found = discovery?.status === 'ready' ? discovery : undefined
  const view = inbox.scope.view
  return {
    scope: found?.scope,
    ...(discovery?.status === 'unavailable' && {
      error: 'Search unavailable. The loaded selection is still shown.',
    }),
    loading,
    resetKey: inbox.reading,
    onSearch: (query) => void onSearch({ view, query }),
    onContinue: () => {
      continueDiscovery(found, view, onSearch)
    },
    onClear: onClearSearch,
  }
}

function triageFor(
  inbox: ReadyDesk,
  scanError: boolean,
  triage: PageProps['triage'],
): NonNullable<ComponentProps<typeof WorkbenchPage>['triage']> {
  return {
    worklistSize: scanComplete(inbox.scope, scanError) ? inbox.messages.length : 0,
    state: triage.state,
    batch: triage.batch,
    onStart: (limits) => void triage.start(limits),
    onResume: () => void triage.resume(),
    onRead: () => void triage.read(),
    onStop: () => void triage.stop(),
    onRestart: () => void triage.restart(),
    onForget: triage.forget,
  }
}

function actionProps(
  reread: () => void,
  refresh: () => void,
  syncLabel: string,
  loading: boolean,
  batchRunning: boolean,
  onRecordWork: PageProps['onRecordWork'],
): Pick<
  ComponentProps<typeof WorkbenchPage>,
  'completion' | 'review' | 'proposals' | 'recordedWork' | 'topBar'
> {
  return {
    completion: { mode: 'read-only' },
    review: {
      mode: 'enabled',
      onSaveReview: ReviewDesk.review,
      onCheckReview: (subject) => checkReviewAndRefresh(subject, reread),
    },
    proposals: {
      mode: 'enabled',
      approver: 'you, at this computer',
      onApprove: ReviewDesk.approveDone,
      onExecute: ReviewDesk.executeDone,
      onConfirmed: reread,
    },
    recordedWork: { onRecord: onRecordWork },
    topBar: {
      syncStatus: 'connected',
      syncLabel,
      syncActionLabel: `Refresh mail · ${syncLabel}`,
      onSyncClick: refresh,
      syncDisabled: loading || batchRunning,
      ...profile,
    },
  }
}

function LoadedPage({
  inbox,
  root,
  onRefresh,
  discovery,
  onSearch,
  onClearSearch,
  scanning,
  scanError,
  loading,
  triage,
  onRecordWork,
}: LoadedPageProps) {
  const rememberReadFocus = useInboxReadFocus(root, loading)
  const reread = () => {
    if (!loading && triage.batch?.status !== 'running') void onRefresh()
  }
  const refresh = () => {
    rememberReadFocus('refresh')
    reread()
  }
  const syncLabel = syncScopeLabel(inbox.scope)
  const found = discovery?.status === 'ready' ? discovery : undefined
  const shown = found ?? inbox
  const refreshSummary = 'refresh' in inbox ? inbox.refresh : undefined
  const reach = mailboxReachItems(shown.scope, shown.mailboxes, refreshSummary)
  return (
    <div ref={root} className="app-root app-root--inbox">
      <div className="inbox-view__workbench">
        <WorkbenchPage
          key={inbox.scope.view}
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
          worklist={{
            coverage: { result: scanComplete(inbox.scope, scanError) ? 'complete' : 'incomplete' },
          }}
          discovery={discoveryFor(inbox, discovery, loading, onSearch, onClearSearch)}
          queueControls={
            <ScanStatus scope={inbox.scope} scanning={scanning} scanError={scanError} />
          }
          triage={triageFor(inbox, scanError, triage)}
          {...actionProps(
            reread,
            refresh,
            syncLabel,
            loading,
            triage.batch?.status === 'running',
            onRecordWork,
          )}
        />
      </div>
    </div>
  )
}

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
function useDeskReading(initial: DeskView) {
  const [inbox, setInbox] = useState<DeskView | DeskRefresh>(initial)
  const [discovery, setDiscovery] = useState<DeskDiscovery>()
  const [loading, setLoading] = useState(false)
  const [scanning, setScanning] = useState(false)
  const scanningRef = useRef(false)
  const [scanError, setScanError] = useState(false)
  const sequence = useRef(0)
  const scan = async (seed?: DeskView) => {
    const current = ++sequence.current
    setDiscovery(undefined)
    setLoading(true)
    setScanning(true)
    scanningRef.current = true
    setScanError(false)
    try {
      let value = seed ?? (await ReviewDesk.open({ view: 'all' }))
      while (current === sequence.current && value.status === 'ready') {
        setInbox(value)
        if (scanInterrupted(value.scope)) break
        value = await ReviewDesk.open({ view: 'all', cursor: value.scope.cursor })
      }
      if (current === sequence.current) setScanError(value.status === 'unavailable')
    } catch {
      if (current === sequence.current) setScanError(true)
    } finally {
      if (current === sequence.current) {
        scanningRef.current = false
        setScanning(false)
        setLoading(false)
      }
    }
  }
  useEffect(() => {
    const scheduled = sequence.current
    queueMicrotask(() => {
      if (initial.status === 'ready' && scheduled === sequence.current) void scan(initial)
    })
    return () => {
      sequence.current += 1
    }
  }, [initial])
  const search = async (next: InboxDiscoveryRequest) => {
    if (scanningRef.current) return
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
    scanning,
    scanError,
    loading,
    read: () => scan(),
    refresh: () => scan(),
    search,
    clearSearch: () => {
      setDiscovery(undefined)
    },
  } as const
}

function scanInterrupted(scope: Extract<DeskView, { status: 'ready' }>['scope']) {
  return !scope.bounded || Boolean(scope.failed.length || scope.incomplete?.length)
}

function loadedMessageSummary(inbox: DeskView | DeskRefresh) {
  const count = inbox.status === 'ready' ? inbox.messages.length : 0
  return {
    count,
    label: `${String(count)} Inbox ${count === 1 ? 'message' : 'messages'}`,
  } as const
}

function useOpenWorkSection() {
  const [section, setSection] = useState<'inbox' | 'work' | 'completed'>('inbox')
  const [openWork, setOpenWork] = useState<OpenWorkRead>()
  const [workLoading, setWorkLoading] = useState(false)
  const [moreLoading, setMoreLoading] = useState(false)
  const [moreError, setMoreError] = useState(false)
  const workSequence = useRef(0)
  const checkWork = async () => {
    const current = ++workSequence.current
    setMoreError(false)
    setMoreLoading(false)
    setWorkLoading(true)
    try {
      const result = await ReviewDesk.openWork()
      if (current === workSequence.current) setOpenWork(result)
    } finally {
      if (current === workSequence.current) setWorkLoading(false)
    }
  }
  const loadMoreWork = async () => {
    if (workLoading || moreLoading || openWork?.status !== 'ready' || openWork.nextCursor === null)
      return
    const current = workSequence.current
    const cursor = openWork.nextCursor
    setMoreLoading(true)
    setMoreError(false)
    try {
      const result = await ReviewDesk.openWork(cursor)
      if (current !== workSequence.current) return
      if (result.status !== 'ready') {
        setMoreError(true)
        return
      }
      setOpenWork((previous) => {
        if (
          previous?.status !== 'ready' ||
          previous.nextCursor?.beforeId !== cursor.beforeId ||
          previous.nextCursor.snapshotId !== cursor.snapshotId
        )
          return previous
        const seen = new Set(previous.items.map((item) => item.copyId))
        const items = sortOpenWorkItems([
          ...previous.items,
          ...result.items.filter((item) => !seen.has(item.copyId)),
        ])
        return { ...result, items, tally: openWorkTally(items) }
      })
    } finally {
      if (current === workSequence.current) setMoreLoading(false)
    }
  }
  const recordWork = async (request: WorkDecisionRequest) => {
    const result = await ReviewDesk.recordWork(request)
    if (result.status === 'recorded' && section !== 'inbox') void checkWork()
    return result
  }
  return {
    section,
    setSection,
    openWork,
    workLoading,
    moreLoading,
    moreError,
    checkWork,
    loadMoreWork,
    recordWork,
  } as const
}

function SectionTabs({
  section,
  onInbox,
  onWork,
  onCompleted,
}: Readonly<{
  section: 'inbox' | 'work' | 'completed'
  onInbox: () => void
  onWork: () => void
  onCompleted: () => void
}>) {
  return (
    <nav className="app-section-tabs" aria-label="Desk sections">
      <button
        type="button"
        aria-current={section === 'inbox' ? 'page' : undefined}
        onClick={onInbox}
      >
        Inbox
      </button>
      <button type="button" aria-current={section === 'work' ? 'page' : undefined} onClick={onWork}>
        Open work
      </button>
      <button
        type="button"
        aria-current={section === 'completed' ? 'page' : undefined}
        onClick={onCompleted}
      >
        Completed decisions
      </button>
    </nav>
  )
}

function OpenWorkPane({
  reading,
  loading,
  onRefresh,
  onLoadMore,
  moreLoading,
  moreError,
  onRecord,
  mode,
}: Readonly<{
  reading: OpenWorkRead | undefined
  loading: boolean
  onRefresh: () => void
  onLoadMore: () => void
  moreLoading: boolean
  moreError: boolean
  onRecord: (request: WorkDecisionRequest) => ReturnType<typeof ReviewDesk.recordWork>
  mode: 'work' | 'completed'
}>) {
  if (!reading) return <main className="app-notice">Checking local work and Spark…</main>
  return (
    <OpenWorkPage
      reading={reading}
      loading={loading}
      onRefresh={onRefresh}
      onLoadMore={onLoadMore}
      moreLoading={moreLoading}
      moreError={moreError}
      onRecord={onRecord}
      onRead={(copy) => ReviewDesk.workMessage({ copy })}
      mode={mode}
    />
  )
}

function useReadyTriage(inbox: DeskView | DeskRefresh, scanError: boolean) {
  const ready = inbox.status === 'ready' && scanComplete(inbox.scope, scanError)
  return useTriageRunController({
    reading: ready ? inbox.reading : undefined,
    worklistSize: ready ? inbox.messages.length : 0,
    gateway: triageGateway,
  })
}

function InboxHome({
  onRecordWork,
}: Readonly<{
  onRecordWork: (request: WorkDecisionRequest) => ReturnType<typeof ReviewDesk.recordWork>
}>) {
  const initial = Route.useLoaderData().value
  const { inbox, discovery, scanning, scanError, loading, read, refresh, search, clearSearch } =
    useDeskReading(initial)
  const root = useRef<HTMLDivElement>(null)
  // Set once Spark answered after the page waited, so the inbox says so.
  const [waited, setWaited] = useState(false)
  const { count, label: messages } = loadedMessageSummary(inbox)
  const notice = useConnectedNotice(root, waited && count > 0)
  const refreshed = inbox.status === 'ready' && 'refresh' in inbox ? inbox.refresh : undefined
  const [dismissedRefresh, setDismissedRefresh] = useState<string>()
  const refreshedNotice = refreshed && refreshNotice(refreshed)
  const triage = useReadyTriage(inbox, scanError)
  const onReady = () => {
    setWaited(true)
    notice.reset()
    return read()
  }
  const onRefresh = () => {
    notice.hide()
    return refresh()
  }
  const onDismissRefresh = () => {
    if (refreshed) setDismissedRefresh(refreshed.refreshedAt)
  }
  return (
    <>
      <Page
        inbox={inbox}
        root={root}
        onReady={onReady}
        onRefresh={onRefresh}
        discovery={discovery}
        onSearch={search}
        onClearSearch={clearSearch}
        scanning={scanning}
        scanError={scanError}
        loading={loading}
        triage={triage}
        onRecordWork={onRecordWork}
      />
      <LocalStatusToast
        visible={notice.visible}
        title="Spark connected"
        detail={`${messages} loaded`}
        dismissLabel="Dismiss"
        onDismiss={notice.hide}
      />
      <LocalStatusToast
        visible={Boolean(refreshed && dismissedRefresh !== refreshed.refreshedAt)}
        title={refreshedNotice?.title}
        detail={refreshedNotice?.detail}
        dismissLabel="Dismiss"
        onDismiss={onDismissRefresh}
      />
    </>
  )
}

function Home() {
  const {
    section,
    setSection,
    openWork,
    workLoading,
    moreLoading,
    moreError,
    checkWork,
    loadMoreWork,
    recordWork,
  } = useOpenWorkSection()
  return (
    <>
      <SectionTabs
        section={section}
        onInbox={() => {
          setSection('inbox')
        }}
        onWork={() => {
          setSection('work')
          void checkWork()
        }}
        onCompleted={() => {
          setSection('completed')
          void checkWork()
        }}
      />
      <div hidden={section !== 'inbox'}>
        <InboxHome onRecordWork={recordWork} />
      </div>
      {section !== 'inbox' && (
        <OpenWorkPane
          mode={section}
          reading={openWork}
          loading={workLoading}
          onRefresh={() => {
            void checkWork()
          }}
          onLoadMore={() => {
            void loadMoreWork()
          }}
          moreLoading={moreLoading}
          moreError={moreError}
          onRecord={recordWork}
        />
      )}
    </>
  )
}
