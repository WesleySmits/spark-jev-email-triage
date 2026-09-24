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
import { coverageFromInboxScope } from '../app/inbox-coverage-adapter'
import { failedCoverage, inboxCoverage, type InboxCoverage } from '../app/inbox-coverage'
import { ReviewDesk, type DeskReason, type DeskView } from '../app/review-desk'
import type { InboxListRequest, InboxScope } from '../app/live-inbox'

export const Route = createFileRoute('/')({
  loader: (): Promise<DeskView> => ReviewDesk.open(),
  component: Home,
  errorComponent: Unreachable,
})

const profile = { profileLabel: 'Profile', profileInitials: 'ME' } as const

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
  inbox: DeskView
  root: RefObject<HTMLDivElement | null>
  onReady: () => Promise<void>
  onRefresh: () => Promise<void>
  onChange: (request: InboxListRequest) => Promise<void>
  coverage: InboxCoverage | undefined
  loading: boolean
}>

function ViewTab({
  label,
  selected,
  disabled,
  onClick,
}: Readonly<{ label: string; selected: boolean; disabled: boolean; onClick: () => void }>) {
  return (
    <button
      type="button"
      aria-current={selected ? 'page' : undefined}
      disabled={disabled}
      onClick={onClick}
    >
      {label}
    </button>
  )
}

function InboxViewBar({
  scope,
  loading,
  onChange,
}: Readonly<{
  scope: InboxScope
  loading: boolean
  onChange: PageProps['onChange']
}>) {
  const { view } = scope
  const retry = (scope.incomplete?.length ?? 0) > 0
  const canLoad = scope.bounded
  const kind = view === 'unread' ? 'unread' : 'read'
  return (
    <nav className="inbox-view" aria-label="Inbox views">
      <div className="inbox-view__tabs">
        <ViewTab
          label="Unread"
          selected={view === 'unread'}
          disabled={loading}
          onClick={() => void onChange({ view: 'unread' })}
        />
        <ViewTab
          label="Other Inbox"
          selected={view === 'other'}
          disabled={loading}
          onClick={() => void onChange({ view: 'other' })}
        />
      </div>
      <span className="inbox-view__note" role="status">
        {loading
          ? 'Loading…'
          : `Showing ${String(scope.loaded)} loaded ${kind} messages · ${String(scope.readable)} readable mailboxes`}
      </span>
      {canLoad && (
        <button
          type="button"
          disabled={loading}
          onClick={() => void onChange({ view, cursor: scope.cursor })}
        >
          {retry ? 'Retry older' : 'Load older'} {kind} messages
        </button>
      )}
    </nav>
  )
}

/** The page for what the loader found: waiting, no mailboxes or the inbox. */
function Page({ inbox, root, onReady, onRefresh, onChange, coverage, loading }: PageProps) {
  const reread = () => {
    void onRefresh()
  }
  if (inbox.status === 'unavailable') return <Connection reason={inbox.reason} onReady={onReady} />
  if (inbox.mailboxes.length === 0) {
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
  // It names what was refreshed: the loaded selection, not a whole mailbox,
  // and whether a mailbox could not be read, because Refresh is what reads
  // them all again. A reading that lost a mailbox keeps the rest, so the
  // retry is global but costs no mail that did arrive.
  const syncLabel = syncScopeLabel(inbox.scope)
  const { view } = inbox.scope
  return (
    <div ref={root} className="app-root app-root--inbox">
      <div className="inbox-view__workbench" inert={loading} aria-busy={loading}>
        <WorkbenchPage
          key={view}
          messages={inbox.messages}
          classifications={{
            reading: inbox.reading,
            states: inbox.classifications,
            reviews: inbox.reviews,
          }}
          loadBody={ReviewDesk.focus(inbox)}
          workflows={ReviewDesk.workflows}
          mailboxes={inbox.mailboxes}
          scope={inbox.scope}
          queueControls={
            <>
              <InboxViewBar scope={inbox.scope} loading={loading} onChange={onChange} />
              {coverage && <InboxZeroStatusBar coverage={coverage} />}
            </>
          }
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
          topBar={{
            syncStatus: 'connected',
            syncLabel,
            syncActionLabel: `Refresh mail · ${syncLabel}`,
            onSyncClick: reread,
            ...profile,
          }}
        />
      </div>
    </div>
  )
}

// Recent Spark mail and stored triage. Reviews change only the local review
// store. The separate Done panel may approve and execute one guarded Spark
// message-ID action when the server kill switch is enabled. Inbox refresh and
// body reads remain read-only and never start an action.
const initialCoverage = (initial: DeskView) =>
  initial.status === 'ready'
    ? inboxCoverage(undefined, coverageFromInboxScope(initial.scope))
    : undefined

function coverageUpdate(
  result: DeskView,
  view: InboxListRequest['view'],
  startedAt: string,
  finishedAt: string,
) {
  return result.status === 'ready'
    ? coverageFromInboxScope(result.scope, startedAt)
    : failedCoverage(view, startedAt, finishedAt)
}

function useDeskReading(initial: DeskView) {
  const [inbox, setInbox] = useState<DeskView>(initial)
  const [coverage, setCoverage] = useState<InboxCoverage | undefined>(() =>
    initialCoverage(initial),
  )
  const [loading, setLoading] = useState(false)
  const request = useRef<InboxListRequest>({ view: 'unread' })
  const sequence = useRef(0)
  const read = async (next: InboxListRequest) => {
    const current = ++sequence.current
    const startedAt = new Date().toISOString()
    request.current = next
    setLoading(true)
    const result = await ReviewDesk.open(next)
    if (current === sequence.current) {
      const update = coverageUpdate(result, next.view, startedAt, new Date().toISOString())
      setInbox(result)
      setCoverage((previous) => inboxCoverage(previous, update))
      setLoading(false)
    }
  }
  return { inbox, coverage, loading, read, request } as const
}

function loadedMessageSummary(inbox: DeskView) {
  const count = inbox.status === 'ready' ? inbox.messages.length : 0
  const kind = inbox.status === 'ready' && inbox.scope.view === 'other' ? 'read' : 'unread'
  return {
    count,
    label: `${String(count)} ${kind} ${count === 1 ? 'message' : 'messages'}`,
  } as const
}

function Home() {
  const initial = Route.useLoaderData()
  const { inbox, coverage, loading, read, request } = useDeskReading(initial)
  const root = useRef<HTMLDivElement>(null)
  // Set once Spark answered after the page waited, so the inbox says so.
  const [waited, setWaited] = useState(false)
  const { count, label: messages } = loadedMessageSummary(inbox)
  const notice = useConnectedNotice(root, waited && count > 0)
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
        onRefresh={() =>
          read({ view: inbox.status === 'ready' ? inbox.scope.view : request.current.view })
        }
        onChange={read}
        coverage={coverage}
        loading={loading}
      />
      <LocalStatusToast
        visible={notice.visible}
        title="Spark connected"
        detail={`${messages} loaded`}
        dismissLabel="Dismiss"
        onDismiss={notice.hide}
      />
    </>
  )
}
