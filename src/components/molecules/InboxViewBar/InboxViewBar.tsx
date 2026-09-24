import type { InboxReadFocus } from '../../../app/inbox-read-focus'
import type { InboxListRequest, InboxScope } from '../../../app/live-inbox'

type ChangeView = (request: InboxListRequest, focus: InboxReadFocus) => Promise<void>

function ViewTab({
  label,
  selected,
  disabled,
  focus,
  onClick,
}: Readonly<{
  label: string
  selected: boolean
  disabled: boolean
  focus: Extract<InboxReadFocus, 'view-unread' | 'view-other'>
  onClick: () => void
}>) {
  return (
    <button
      type="button"
      aria-current={selected ? 'page' : undefined}
      data-inbox-read-focus={focus}
      disabled={disabled}
      onClick={onClick}
    >
      {label}
    </button>
  )
}

export function InboxViewBar({
  scope,
  loading,
  onChange,
}: Readonly<{ scope: InboxScope; loading: boolean; onChange: ChangeView }>) {
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
          focus="view-unread"
          onClick={() => void onChange({ view: 'unread' }, 'view-unread')}
        />
        <ViewTab
          label="Other Inbox"
          selected={view === 'other'}
          disabled={loading}
          focus="view-other"
          onClick={() => void onChange({ view: 'other' }, 'view-other')}
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
          data-inbox-read-focus="load-older"
          disabled={loading}
          onClick={() => void onChange({ view, cursor: scope.cursor }, 'load-older')}
        >
          {retry ? 'Retry older' : 'Load older'} {kind} messages
        </button>
      )}
    </nav>
  )
}
