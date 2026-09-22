import { EmptyState } from '../../molecules/EmptyState/EmptyState'
import { ConnectionPanel } from '../../molecules/ConnectionPanel/ConnectionPanel'
import { QueueHeader } from '../../molecules/QueueHeader/QueueHeader'
import { Sidebar, type SidebarItem } from '../../organisms/Sidebar/Sidebar'
import { TopBar } from '../../organisms/TopBar/TopBar'
import { WorkbenchTemplate } from '../../templates/WorkbenchTemplate/WorkbenchTemplate'
import type { ConnectionView } from './connection'
import './ConnectionPage.css'

type ConnectionPageProps = Readonly<{
  /** What to show; see `connectionView`. */
  connection: ConnectionView
  /** Runs one check now, from the panel's action or the top-bar status. */
  onCheckNow: () => void
  /** The workflow the inbox will open in, shown as the rail's only row. */
  workflows: readonly SidebarItem[]
  profileLabel: string
  profileInitials: string
}>

const readOnly = 'Read only. This app never changes your mail.'

const ignore = () => undefined

/**
 * The workbench while there is no mail to show: Direction A, "In place".
 * The top bar, rail, queue and reader stay where the inbox will be. The
 * queue pane holds the connection state and Check now, the reader says
 * where mail will open. On mobile the queue pane is the page.
 *
 * Presentational only. The caller owns the checks, their timing and the
 * copy, e.g. through `useReconnect` and `connectionView`. With no mail the
 * search is disabled and the page has no J, K or / shortcuts, and it never
 * shows sample mail.
 *
 * @example
 * import { ConnectionPage } from '../components/pages/ConnectionPage/ConnectionPage'
 *
 * <div style={{ height: '100dvh' }}>
 *   <ConnectionPage
 *     connection={connectionView(state)}
 *     onCheckNow={checkNow}
 *     workflows={[{ id: 'inbox', icon: 'inbox', label: 'Recent mail' }]}
 *     profileLabel="Profile"
 *     profileInitials="ME"
 *   />
 * </div>
 */
export function ConnectionPage({
  connection,
  onCheckNow,
  workflows,
  profileLabel,
  profileInitials,
}: ConnectionPageProps) {
  const { action, sync, reader } = connection
  return (
    <div className="connection-page">
      <WorkbenchTemplate
        mobilePane="queue"
        topBar={
          <TopBar
            searchLabel="Search current results"
            searchPlaceholder="Search current results"
            searchValue=""
            searchDisabled
            onSearchChange={ignore}
            onSearchSubmit={ignore}
            syncStatus={sync.status}
            syncLabel={sync.label}
            onSyncClick={sync.checks ? onCheckNow : undefined}
            profileLabel={profileLabel}
            profileInitials={profileInitials}
          />
        }
        sidebar={
          <Sidebar
            label="Filters"
            groups={[
              {
                id: 'workflow',
                label: 'Workflows',
                items: workflows,
                selectedId: workflows[0]?.id ?? null,
              },
              { id: 'mailbox', label: 'Mailboxes', items: [], emptyLabel: connection.mailboxes },
            ]}
            onSelect={ignore}
          />
        }
        queue={
          <div className="connection-page__queue">
            <QueueHeader
              title={workflows[0]?.label ?? 'Recent mail'}
              headingLevel={1}
              count=""
              context={connection.context}
            />
            <ConnectionPanel
              tone={connection.tone}
              title={connection.title}
              steps={connection.steps}
              description={connection.description}
              meta={connection.meta}
              hint={connection.hint}
              action={action && { ...action, onClick: onCheckNow }}
              note={readOnly}
            />
          </div>
        }
        reader={<EmptyState icon="inbox" title={reader.title} description={reader.description} />}
      />
    </div>
  )
}
