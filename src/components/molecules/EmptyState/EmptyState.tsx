import type { ComponentProps, ReactNode } from 'react'
import { Button } from '../../atoms/Button/Button'
import { Icon } from '../../atoms/Icon/Icon'
import './EmptyState.css'

type EmptyStateAction = Readonly<{
  /** Visible text and accessible name of the button, e.g. "Show all mailboxes". */
  label: string
  onClick: () => void
  /** Optional icon before the label. It is hidden from assistive technology. */
  icon?: ComponentProps<typeof Icon>['name'] | undefined
  /** The screen's primary action lives elsewhere, so this is never primary. Defaults to secondary. */
  variant?: 'secondary' | 'quiet' | undefined
}>

type EmptyStateProps = Readonly<{
  /** Names the active scope, e.g. "No results in this filter". */
  title: string
  /** Level of the title heading. Defaults to 2; use 3 under a QueueHeader. */
  headingLevel?: 2 | 3 | 4 | undefined
  /** Id for the heading, so the caller can name a region with `aria-labelledby`. */
  titleId?: string | undefined
  /** Why it is empty and the next useful step, e.g. "Choose another queue or mailbox." */
  description: ReactNode
  /** Optional decorative icon above the title. */
  icon?: ComponentProps<typeof Icon>['name'] | undefined
  /** One optional next step. The caller owns what it does. */
  action?: EmptyStateAction | undefined
  className?: string | undefined
}>

/**
 * What a queue, list or reader shows when it has nothing to show: a title that
 * names the scope, a line with the next useful step, and one optional action.
 *
 * Presentational only. The caller writes the copy and handles the action. It
 * is not a live region: when an empty state replaces content after a user
 * action, the caller decides whether and how to announce it. The background is
 * transparent, so it takes the surface it sits on (`--paper` or `--surface`).
 *
 * @example
 * import { EmptyState } from '../components/molecules/EmptyState/EmptyState'
 *
 * <EmptyState
 *   headingLevel={3}
 *   icon="inbox"
 *   title="No results in this filter"
 *   description="Choose another queue or mailbox."
 *   action={{ label: 'Show all mailboxes', onClick: clearMailboxFilter }}
 * />
 */
export function EmptyState({
  title,
  headingLevel = 2,
  titleId,
  description,
  icon,
  action,
  className,
}: EmptyStateProps) {
  const Heading = `h${String(headingLevel)}` as `h${NonNullable<typeof headingLevel>}`
  const classes = ['empty-state', className].filter(Boolean).join(' ')
  return (
    <div className={classes}>
      {icon && (
        <span className="empty-state__icon">
          <Icon name={icon} />
        </span>
      )}
      <Heading id={titleId} className="empty-state__title">
        {title}
      </Heading>
      <p className="empty-state__description">{description}</p>
      {action && (
        <Button
          className="empty-state__action"
          variant={action.variant ?? 'secondary'}
          onClick={action.onClick}
        >
          {action.icon && <Icon name={action.icon} size="sm" />}
          {action.label}
        </Button>
      )}
    </div>
  )
}
