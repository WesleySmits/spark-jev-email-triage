import type { ComponentPropsWithRef, ReactNode } from 'react'
import { Button } from '../../atoms/Button/Button'
import { StatusDot } from '../../atoms/StatusDot/StatusDot'
import './SyncStatusButton.css'

type SyncStatusButtonProps = Omit<ComponentPropsWithRef<'button'>, 'children'> & {
  /** Sets the dot and text color. Defaults to connected. */
  status?: 'connected' | 'disconnected' | undefined
  /**
   * Visible status text, which is also the button's name. Say what the state
   * is and when it last changed, e.g. "Updated 2 min ago" or
   * "Disconnected · last sync 10:14".
   */
  children: ReactNode
}

/**
 * The top-bar sync status: a StatusDot and short status text in a quiet
 * button. It only shows what the caller passes; the caller decides what a
 * click does. It is not a live region, so announce sync changes elsewhere.
 * The text wraps rather than truncates when space runs out.
 *
 * @example
 * import { SyncStatusButton } from '../components/molecules/SyncStatusButton/SyncStatusButton'
 *
 * <SyncStatusButton onClick={onSyncDetails}>Updated 2 min ago</SyncStatusButton>
 * <SyncStatusButton status="disconnected" onClick={onReconnect}>
 *   Disconnected · last sync 10:14
 * </SyncStatusButton>
 */
export function SyncStatusButton({
  status = 'connected',
  className,
  children,
  ...props
}: SyncStatusButtonProps) {
  const classes = ['sync-status-button', `sync-status-button--${status}`, className]
    .filter(Boolean)
    .join(' ')
  return (
    <Button {...props} variant="quiet" className={classes}>
      <StatusDot tone={status === 'connected' ? 'success' : 'danger'} />
      <span className="sync-status-button__text">{children}</span>
    </Button>
  )
}
