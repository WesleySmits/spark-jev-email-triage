import { useEffect, useRef, useState, type RefObject } from 'react'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { EmptyState } from '../components/molecules/EmptyState/EmptyState'
import { LocalStatusToast } from '../components/molecules/LocalStatusToast/LocalStatusToast'
import { ConnectionPage } from '../components/pages/ConnectionPage/ConnectionPage'
import { connectionView } from '../components/pages/ConnectionPage/connection'
import { useReconnect } from '../components/pages/ConnectionPage/useReconnect'
import { WorkbenchPage } from '../components/pages/WorkbenchPage/WorkbenchPage'
import { ReviewDesk, type DeskReason, type DeskView } from '../app/review-desk'

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
}>

/** The page for what the loader found: waiting, no mailboxes or the inbox. */
function Page({ inbox, root, onReady }: PageProps) {
  const router = useRouter()
  const reread = () => {
    void router.invalidate()
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
  // It names what was refreshed: the loaded selection, not a whole mailbox.
  const syncLabel = `Loaded mail updated at ${inbox.scope.readAt} · read only`
  return (
    <div ref={root} className="app-root">
      <WorkbenchPage
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
        topBar={{
          syncStatus: 'connected',
          syncLabel,
          syncActionLabel: `Refresh mail · ${syncLabel}`,
          onSyncClick: reread,
          ...profile,
        }}
      />
    </div>
  )
}

// Recent Spark mail beside what shadow triage last stored about it. The
// mail itself is read-only: nothing here completes, archives or moves a
// message. The one thing a person may record is a review of one stored
// classification, which is kept beside that classification and changes no
// mail. A review that was saved is read back with the rows it belongs to, so
// it still decides what they show after a refresh, while what the classifier
// proposed stays beside it. Rows arrive without bodies; one body loads when
// its message opens, and that read is the only thing that can say a stored
// judgment still describes the row. Refresh lists the mailbox again under a
// new reading, so what an earlier read proved stops counting as proof
// without anything being read again. Neither refreshing nor opening a row
// calls a classifier. While Spark is away the workbench waits in place and
// reads the inbox once it answers.
function Home() {
  const inbox = Route.useLoaderData()
  const router = useRouter()
  const root = useRef<HTMLDivElement>(null)
  // Set once Spark answered after the page waited, so the inbox says so.
  const [waited, setWaited] = useState(false)
  const count = inbox.status === 'ready' ? inbox.messages.length : 0
  const notice = useConnectedNotice(root, waited && count > 0)
  const messages = `${String(count)} recent ${count === 1 ? 'message' : 'messages'}`
  return (
    <>
      <Page
        inbox={inbox}
        root={root}
        onReady={() => {
          setWaited(true)
          notice.reset()
          return router.invalidate()
        }}
      />
      <LocalStatusToast
        visible={notice.visible}
        title="Spark connected"
        detail={`${messages} · read only`}
        dismissLabel="Dismiss"
        onDismiss={notice.hide}
      />
    </>
  )
}
