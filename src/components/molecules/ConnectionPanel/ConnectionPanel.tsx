import type { ComponentProps } from 'react'
import { Button } from '../../atoms/Button/Button'
import { Icon } from '../../atoms/Icon/Icon'
import { StatusDot } from '../../atoms/StatusDot/StatusDot'
import './ConnectionPanel.css'

type ConnectionPanelAction = Readonly<{
  /** Visible text and accessible name, e.g. "Check now" or "Checking…". */
  label: string
  /**
   * A check runs. The button stays in place and keeps focus, but says so
   * with `aria-disabled` and ignores clicks.
   */
  busy?: boolean | undefined
  onClick: () => void
}>

type ConnectionPanelProps = Readonly<{
  /** The dot beside the heading. */
  tone: NonNullable<ComponentProps<typeof StatusDot>['tone']>
  /** The state, e.g. "Waiting for Spark". Announced politely when it changes. */
  title: string
  /** Level of the heading. Defaults to 2. */
  headingLevel?: 2 | 3 | undefined
  /** What to do, as numbered steps. */
  steps?: readonly string[] | undefined
  /** What is going on, one paragraph per entry. */
  description?: readonly string[] | undefined
  /** When it was last checked and how often, e.g. "Last checked 09:41:08". Not announced. */
  meta?: string | undefined
  /** A second line under `meta`, e.g. advice after a long wait. */
  hint?: string | undefined
  /** One optional action, e.g. Check now. */
  action?: ConnectionPanelAction | undefined
  /** A quiet closing line, e.g. that nothing here changes mail. */
  note?: string | undefined
  className?: string | undefined
}>

/** The busy action keeps its place and focus, but ignores clicks. */
function Action({ label, busy = false, onClick }: ConnectionPanelAction) {
  return (
    <Button
      variant="secondary"
      className="connection-panel__action"
      aria-disabled={busy || undefined}
      onClick={busy ? undefined : onClick}
    >
      <span className={busy ? 'connection-panel__spin' : undefined}>
        <Icon name="refresh" size="sm" />
      </span>
      {label}
    </Button>
  )
}

type FooterProps = Pick<ConnectionPanelProps, 'meta' | 'hint' | 'action'>

/** When it was last checked, advice, and the one action. Outside the status region. */
function Footer({ meta, hint, action }: FooterProps) {
  const text = meta ?? hint
  if (text === undefined && action === undefined) return null
  return (
    <div className="connection-panel__footer">
      {text !== undefined && (
        <p className="connection-panel__meta">
          {meta}
          {hint && <span className="connection-panel__hint">{hint}</span>}
        </p>
      )}
      {action && <Action {...action} />}
    </div>
  )
}

/**
 * The connection state of a page that waits for its mail provider: a
 * status heading, what to do, when it was last checked, one action and a
 * quiet note. A recoverable connection, not a failure: it uses no danger
 * colors.
 *
 * Presentational only. The caller owns the copy, the checks and their
 * timing. Only the heading sits in the polite status region, so a change of
 * state is announced once and the ticking "Last checked" line never is.
 * Keep the panel mounted while the state changes, so the region and the
 * action's focus survive. A busy action keeps its place and focus.
 *
 * @example
 * import { ConnectionPanel } from '../components/molecules/ConnectionPanel/ConnectionPanel'
 *
 * <ConnectionPanel
 *   tone="waiting"
 *   title="Waiting for Spark"
 *   steps={['Open Spark on this Mac.', 'Check that you are signed in.']}
 *   meta="Last checked 09:41:08 · Checks every 10 seconds"
 *   action={{ label: 'Check now', onClick: checkNow }}
 *   note="Read only. This app never changes your mail."
 * />
 */
export function ConnectionPanel({
  tone,
  title,
  headingLevel = 2,
  steps = [],
  description = [],
  meta,
  hint,
  action,
  note,
  className,
}: ConnectionPanelProps) {
  const Heading = `h${String(headingLevel)}` as `h${NonNullable<typeof headingLevel>}`
  const classes = ['connection-panel', className].filter(Boolean).join(' ')
  return (
    <div className={classes}>
      <div role="status" aria-live="polite" className="connection-panel__status">
        <StatusDot tone={tone} />
        <Heading className="connection-panel__title">{title}</Heading>
      </div>
      {steps.length > 0 && (
        <ol className="connection-panel__steps">
          {steps.map((step) => (
            <li key={step} className="connection-panel__step">
              {step}
            </li>
          ))}
        </ol>
      )}
      {description.map((paragraph) => (
        <p key={paragraph} className="connection-panel__text">
          {paragraph}
        </p>
      ))}
      <Footer meta={meta} hint={hint} action={action} />
      {note && (
        <p className="connection-panel__note">
          <Icon name="check" size="sm" />
          {note}
        </p>
      )}
    </div>
  )
}
