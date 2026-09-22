import { createFileRoute, useRouter } from '@tanstack/react-router'
import { DisconnectedState } from '../components/molecules/DisconnectedState/DisconnectedState'
import { EmptyState } from '../components/molecules/EmptyState/EmptyState'
import { WorkbenchPage } from '../components/pages/WorkbenchPage/WorkbenchPage'
import { getLiveBody, getLiveInbox } from '../app/live-inbox.functions'
import { liveBodyLoader, liveWorkflows, type LiveInbox } from '../app/live-inbox'

export const Route = createFileRoute('/')({
  loader: () => getLiveInbox(),
  component: Home,
  errorComponent: Unreachable,
})

type Unavailable = Extract<LiveInbox, { status: 'unavailable' }>['reason'] | 'unreachable'

const unavailable: Readonly<Record<Unavailable, Readonly<{ title: string; detail: string }>>> = {
  'local-only': {
    title: 'Live mail is only shown on this computer',
    detail: 'Open the app on the Mac that runs Spark.',
  },
  missing: {
    title: 'Spark is not installed here',
    detail: 'The Spark app was not found on this computer, so no mail is shown.',
  },
  failed: {
    title: 'Spark is unavailable',
    detail: 'Spark did not answer. Check that it is open and signed in, then try again.',
  },
  malformed: {
    title: 'Spark sent something unexpected',
    detail: 'The mail list could not be read safely, so none is shown. Try again later.',
  },
  unreachable: {
    title: 'The app server did not answer',
    detail: 'Check that the app is still running, then try again.',
  },
}

/** Rereads the inbox. Nothing here changes mail. */
function useReread() {
  const router = useRouter()
  return () => {
    void router.invalidate()
  }
}

function Notice({ reason }: Readonly<{ reason: Unavailable }>) {
  const reread = useReread()
  const { title, detail } = unavailable[reason]
  return (
    <main className="app-notice">
      <DisconnectedState title={title} action={{ label: 'Try again', onClick: reread }}>
        {detail} Nothing was changed in your mail.
      </DisconnectedState>
    </main>
  )
}

function Unreachable() {
  return <Notice reason="unreachable" />
}

// Recent Spark mail, strictly read-only. Rows arrive without bodies; one body
// loads when its message opens. Refresh only reads again.
function Home() {
  const inbox = Route.useLoaderData()
  const reread = useReread()
  if (inbox.status === 'unavailable') return <Notice reason={inbox.reason} />
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
  const loadBody = liveBodyLoader(inbox.messages, (data, signal) => getLiveBody({ data, signal }))
  return (
    <div className="app-root">
      <WorkbenchPage
        messages={inbox.messages}
        loadBody={loadBody}
        workflows={liveWorkflows}
        mailboxes={inbox.mailboxes}
        completion={{ mode: 'read-only' }}
        topBar={{
          syncStatus: 'connected',
          syncLabel: `Read at ${inbox.readAt} · read only`,
          onSyncClick: reread,
          profileLabel: 'Profile',
          profileInitials: 'ME',
        }}
      />
    </div>
  )
}
