import type { ReactNode } from 'react'
import { Button } from '../../atoms/Button/Button'
import { Icon } from '../../atoms/Icon/Icon'
import './DisconnectedState.css'

type DisconnectedStateAction = Readonly<{
  /** Visible text and accessible name, e.g. "Try again". Never "Reconnected". */
  label: string
  /** The caller owns what this does and when the state goes away. */
  onClick: () => void
}>

type DisconnectedStateProps = Readonly<{
  /** Short failure heading, e.g. "Spark is unavailable". */
  title: string
  /** Level of the heading. Defaults to 2. */
  headingLevel?: 2 | 3 | undefined
  /**
   * What still works and what to do next, e.g. "Your local review is still
   * available. Try again, or check your connection."
   */
  children: ReactNode
  /**
   * What the screen shows until readback, e.g. "Showing local data from
   * 10:14. Spark may have changed since."
   */
  lastKnown?: ReactNode | undefined
  /** One optional recovery action. Leave it out when there is nothing to retry. */
  action?: DisconnectedStateAction | undefined
  /**
   * Announces the heading and recovery copy politely. Set to false when
   * another live region, such as a toast, already announces this failure.
   * Defaults to true.
   */
  announce?: boolean | undefined
  className?: string | undefined
}>

/**
 * An in-place panel for a provider or connection failure: a danger heading,
 * recovery copy, optional last-known context and one optional retry action.
 *
 * Presentational only. The caller owns the copy, the action and when the
 * panel shows or goes away. It has no success or loading look: keep it on
 * screen after a retry until a readback confirms the remote state, and never
 * word the copy as if a remote change went through.
 *
 * The heading and recovery copy sit in a polite status region, not an alert:
 * local work keeps going, so the failure should not interrupt. Mount the panel
 * when the failure happens so the region is announced once. The context and
 * the action sit outside the region, so they are read in order but not
 * announced. The panel never takes focus; the icon is decorative.
 *
 * @example
 * import { DisconnectedState } from '../components/molecules/DisconnectedState/DisconnectedState'
 *
 * <DisconnectedState
 *   title="Spark is unavailable"
 *   lastKnown="Showing local data from 10:14. Spark may have changed since."
 *   action={{ label: 'Try again', onClick: retry }}
 * >
 *   Your local review is still available. Nothing is sent to Spark until it is back.
 * </DisconnectedState>
 */
export function DisconnectedState({
  title,
  headingLevel = 2,
  children,
  lastKnown,
  action,
  announce = true,
  className,
}: DisconnectedStateProps) {
  const Heading = `h${String(headingLevel)}` as `h${NonNullable<typeof headingLevel>}`
  const classes = ['disconnected-state', className].filter(Boolean).join(' ')
  const live = announce ? ({ role: 'status', 'aria-live': 'polite' } as const) : {}
  return (
    <div className={classes}>
      <div {...live} className="disconnected-state__message">
        <div className="disconnected-state__head">
          <Icon name="alert" />
          <Heading className="disconnected-state__title">{title}</Heading>
        </div>
        <p className="disconnected-state__recovery">{children}</p>
      </div>
      {(Boolean(lastKnown) || action !== undefined) && (
        <div className="disconnected-state__footer">
          {lastKnown && <p className="disconnected-state__last-known">{lastKnown}</p>}
          {action && (
            <Button
              variant="secondary"
              className="disconnected-state__action"
              onClick={action.onClick}
            >
              {action.label}
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
