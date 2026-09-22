import type { ComponentProps, ComponentPropsWithRef, ReactNode } from 'react'
import { Button } from '../../atoms/Button/Button'
import { StatusDot } from '../../atoms/StatusDot/StatusDot'
import './SyncStatusButton.css'

/**
 * `connected` and `disconnected` are the sync states. `waiting`, `checking`
 * and `idle` describe a page that waits for Spark: expected back, being
 * checked now, or not checked on its own.
 */
export type SyncStatus = 'connected' | 'disconnected' | 'waiting' | 'checking' | 'idle'

const tones: Readonly<Record<SyncStatus, ComponentProps<typeof StatusDot>['tone']>> = {
  connected: 'success',
  disconnected: 'danger',
  waiting: 'waiting',
  checking: 'checking',
  idle: 'neutral',
}

type SyncStatusButtonProps = Omit<ComponentPropsWithRef<'button'>, 'children'> & {
  /** Sets the dot and text color. Defaults to connected. */
  status?: SyncStatus | undefined
  /**
   * Visible status text, which is also the button's name. Say what the state
   * is and when it last changed, e.g. "Updated 2 min ago" or
   * "Disconnected · last sync 10:14".
   */
  children: ReactNode
}

const classesFor = (status: SyncStatus, className: string | undefined) =>
  ['sync-status-button', `sync-status-button--${status}`, className].filter(Boolean).join(' ')

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
  return (
    <Button {...props} variant="quiet" className={classesFor(status, className)}>
      <StatusDot tone={tones[status]} />
      <span className="sync-status-button__text">{children}</span>
    </Button>
  )
}

type SyncStatusTextProps = Readonly<{
  status: SyncStatus
  children: ReactNode
  className?: string | undefined
}>

/**
 * The same status as plain text, for when a click has nothing to do, e.g. a
 * page that never checks from this computer.
 */
export function SyncStatusText({ status, children, className }: SyncStatusTextProps) {
  return (
    <p className={`${classesFor(status, className)} sync-status-button--text`}>
      <StatusDot tone={tones[status]} />
      <span className="sync-status-button__text">{children}</span>
    </p>
  )
}
