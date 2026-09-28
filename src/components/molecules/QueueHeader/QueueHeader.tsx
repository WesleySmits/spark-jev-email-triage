import type { ComponentProps, ReactNode } from 'react'
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
  /**
   * What could not be read and how to try again, e.g. "1 mailbox could not
   * be read…". Left out, the header says nothing about failure. It is
   * announced when it appears, because a reading that lost part of itself
   * changes what the list means without changing where focus is.
   */
  unread?: string | undefined
  /** When this reading was read: the words shown, and the instant behind them. */
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
   * what bounded it, what could not be read, and when it was last refreshed.
   * `bounded` marks it as a cut selection rather than everything there is.
   * The caller writes the words; only the refresh instant is rendered as
   * machine-readable time.
   */
  scope?: QueueHeaderScope | undefined
  /** Keep the reach warning visible while moving its full explanation behind Details. */
  compactScope?: boolean | undefined
  scopeCompactLabel?: string | undefined
  /** View controls under the scope, when this queue can load another selection. */
  controls?: ReactNode
  /** One optional action beside the title. The caller owns what it does. */
  action?: QueueHeaderAction | undefined
  className?: string | undefined
}>

function reachText(scope: QueueHeaderScope) {
  const warnings = [
    scope.unread && 'mailbox unavailable',
    scope.bounded && 'more mail may remain',
  ].filter(Boolean)
  return warnings.length > 0 ? warnings.join(' · ') : 'reading complete'
}

function ScopeDetails({
  scope,
  compact,
  label,
}: Readonly<{ scope: QueueHeaderScope; compact: boolean; label?: string | undefined }>) {
  if (compact) {
    return (
      <details className="queue-header__reach">
        <summary>
          <span className="queue-header__reach-label" role={scope.unread ? 'status' : undefined}>
            {label ?? scope.summary} · {reachText(scope)}
          </span>
          <span className="queue-header__reach-action">Details</span>
        </summary>
        <div className="queue-header__reach-detail">
          <p>{scope.summary}</p>
          <p>{scope.detail}</p>
          {scope.unread && <p role="status">{scope.unread}</p>}
          <time dateTime={scope.refreshed.dateTime}>{scope.refreshed.label}</time>
        </div>
      </details>
    )
  }
  return (
    <p
      className={
        scope.bounded ? 'queue-header__scope queue-header__scope--bounded' : 'queue-header__scope'
      }
    >
      <span className="queue-header__scope-summary">{scope.summary}</span>
      <span className="queue-header__scope-detail">{scope.detail}</span>
      {scope.unread && (
        <span className="queue-header__scope-unread" role="status">
          {scope.unread}
        </span>
      )}
      <time className="queue-header__scope-refreshed" dateTime={scope.refreshed.dateTime}>
        {scope.refreshed.label}
      </time>
    </p>
  )
}

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
  compactScope = false,
  scopeCompactLabel,
  controls,
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
        {scope && <ScopeDetails scope={scope} compact={compactScope} label={scopeCompactLabel} />}
        {controls}
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
