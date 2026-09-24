import type { ComponentProps } from 'react'
import { Button } from '../../atoms/Button/Button'
import { Icon } from '../../atoms/Icon/Icon'
import './QueueHeader.css'

type QueueHeaderAction = Readonly<{
  /** Visible text and accessible name of the button, e.g. "Refresh". */
  label: string
  onClick: () => void
  /** Optional icon before the label. It is hidden from assistive technology. */
  icon?: ComponentProps<typeof Icon>['name'] | undefined
  /** The primary action belongs to the reader, so this is never primary. Defaults to secondary. */
  variant?: 'secondary' | 'quiet' | undefined
  disabled?: boolean | undefined
}>

type QueueHeaderScope = Readonly<{
  /** The counted line, e.g. "Loaded: 50 recent messages from 5 of 7 readable mailboxes". */
  summary: string
  /** What bounded it and what the search covers. */
  detail: string
  /** The last successful refresh: the words shown, and the instant behind them. */
  refreshed: Readonly<{
    /** Already formatted, e.g. "Last refreshed 09:42." */
    label: string
    /** Machine-readable form of that moment, e.g. an ISO instant. */
    dateTime: string
  }>
  /** Whether a bound may have cut it, which the line is marked for. */
  bounded: boolean
}>

type QueueHeaderProps = Readonly<{
  /** The queue's name, e.g. "Needs review". */
  title: string
  /** Level of the title heading. The source uses 1; defaults to 2. */
  headingLevel?: 1 | 2 | 3 | undefined
  /** Id for the heading, so the caller can name its list with `aria-labelledby`. */
  titleId?: string | undefined
  /** Visible count, already formatted and pluralized, e.g. "3 results". */
  count: string
  /** One line of scope under the title, e.g. "All accounts · current filter". */
  context?: string | undefined
  /**
   * What the list actually holds, under the context line: a counted line,
   * what bounded it, and when it was last refreshed. `bounded` marks it as a
   * cut selection rather than everything there is. The caller writes the
   * words; only the refresh instant is rendered as machine-readable time.
   */
  scope?: QueueHeaderScope | undefined
  /** One optional action beside the title. The caller owns what it does. */
  action?: QueueHeaderAction | undefined
  className?: string | undefined
}>

/**
 * The title block above the queue: title, count, scope and one optional action.
 *
 * Presentational only. The caller formats the count and context and handles
 * the action. The count and context sit outside the heading, so the heading's
 * name is the title alone.
 *
 * @example
 * import { QueueHeader } from '../components/molecules/QueueHeader/QueueHeader'
 *
 * <section aria-labelledby="queue-title">
 *   <QueueHeader
 *     title="Needs review"
 *     titleId="queue-title"
 *     count="3 results"
 *     context="All accounts · current filter"
 *     action={{ label: 'Refresh', onClick: refresh }}
 *   />
 *   <ul>…</ul>
 * </section>
 */
export function QueueHeader({
  title,
  headingLevel = 2,
  titleId,
  count,
  context,
  scope,
  action,
  className,
}: QueueHeaderProps) {
  const Heading = `h${String(headingLevel)}` as `h${NonNullable<typeof headingLevel>}`
  const classes = ['queue-header', className].filter(Boolean).join(' ')
  return (
    <div className={classes}>
      <div className="queue-header__text">
        <div className="queue-header__title-row">
          <Heading id={titleId} className="queue-header__title">
            {title}
          </Heading>
          <span className="queue-header__count">{count}</span>
        </div>
        {context && <p className="queue-header__context">{context}</p>}
        {scope && (
          <p
            className={
              scope.bounded
                ? 'queue-header__scope queue-header__scope--bounded'
                : 'queue-header__scope'
            }
          >
            <span className="queue-header__scope-summary">{scope.summary}</span>
            <span className="queue-header__scope-detail">{scope.detail}</span>
            <time className="queue-header__scope-refreshed" dateTime={scope.refreshed.dateTime}>
              {scope.refreshed.label}
            </time>
          </p>
        )}
      </div>
      {action && (
        <Button
          className="queue-header__action"
          variant={action.variant ?? 'secondary'}
          disabled={action.disabled}
          onClick={action.onClick}
        >
          {action.icon && <Icon name={action.icon} size="sm" />}
          {action.label}
        </Button>
      )}
    </div>
  )
}
