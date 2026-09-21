import type { KeyboardEvent, ReactNode } from 'react'
import { Button } from '../../atoms/Button/Button'
import { Icon } from '../../atoms/Icon/Icon'
import './LocalStatusToast.css'

type LocalStatusToastProps = Readonly<{
  /** Shows the toast. The caller owns this; nothing hides it on a timer. */
  visible: boolean
  /** What changed, e.g. "Handled locally". */
  title: ReactNode
  /**
   * Supporting line. After a completion, say the result is local and the
   * mailbox is unchanged, e.g. "Mailbox unchanged."
   */
  detail?: ReactNode | undefined
  /** Optional text action, e.g. "Undo". Leave it out when there is nothing to undo. */
  actionLabel?: string | undefined
  onAction?: (() => void) | undefined
  /** Visible name of the dismiss action, e.g. "Dismiss". */
  dismissLabel: string
  /** Called from the dismiss action and from Escape inside the toast. */
  onDismiss: () => void
}>

/**
 * Transient feedback after a local change, bottom right of the viewport and
 * full width on narrow screens. It only shows what the caller passes: the
 * caller decides when it is visible, what the actions do and when it hides.
 *
 * The status region stays in the page while hidden and only its content comes
 * and goes, so screen readers announce each new message once, politely. The
 * icon is decorative, and the actions sit outside the region so they are not
 * read as part of the message. The toast never takes focus. When it hides
 * while focus is on one of its actions, move focus back to where the user
 * was working.
 *
 * @example
 * import { LocalStatusToast } from '../components/molecules/LocalStatusToast/LocalStatusToast'
 *
 * <LocalStatusToast
 *   visible={toast !== null}
 *   title="Handled locally"
 *   detail="Mailbox unchanged."
 *   actionLabel="Undo"
 *   onAction={undo}
 *   dismissLabel="Dismiss"
 *   onDismiss={hideToast}
 * />
 */
export function LocalStatusToast({
  visible,
  title,
  detail,
  actionLabel,
  onAction,
  dismissLabel,
  onDismiss,
}: LocalStatusToastProps) {
  function onKeyDown(event: KeyboardEvent) {
    if (event.key === 'Escape') onDismiss()
  }

  return (
    <div
      className={`local-status-toast${visible ? ' local-status-toast--visible' : ''}`}
      onKeyDown={visible ? onKeyDown : undefined}
    >
      <div role="status" aria-live="polite" className="local-status-toast__status">
        {visible && (
          <>
            <Icon name="check" />
            <p className="local-status-toast__copy">
              <strong className="local-status-toast__title">{title}</strong>
              {detail && <span className="local-status-toast__detail">{detail}</span>}
            </p>
          </>
        )}
      </div>
      {visible && (
        <div className="local-status-toast__actions">
          {actionLabel && onAction && (
            <Button variant="quiet" className="local-status-toast__action" onClick={onAction}>
              {actionLabel}
            </Button>
          )}
          <Button variant="quiet" className="local-status-toast__action" onClick={onDismiss}>
            {dismissLabel}
          </Button>
        </div>
      )}
    </div>
  )
}
