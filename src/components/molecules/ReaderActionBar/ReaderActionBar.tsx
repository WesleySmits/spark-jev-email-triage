import type { ComponentProps } from 'react'
import { Button } from '../../atoms/Button/Button'
import { Icon } from '../../atoms/Icon/Icon'
import { KeyboardHint } from '../../atoms/KeyboardHint/KeyboardHint'
import './ReaderActionBar.css'

type ReaderAction = Readonly<{
  /** Visible text and accessible name of the button, e.g. "Archive". Unique in the bar. */
  label: string
  onClick: () => void
  /** Optional icon before the label. It is hidden from assistive technology. */
  icon?: ComponentProps<typeof Icon>['name'] | undefined
  /**
   * One key that triggers the action, e.g. `E`. It is shown as a hint and
   * exposed as `aria-keyshortcuts`, but only while the action is enabled. The
   * caller handles the key.
   */
  shortcut?: string | undefined
  disabled?: boolean | undefined
}>

type SecondaryReaderAction = ReaderAction &
  Readonly<{
    /** Defaults to secondary. The bar has at most one primary action. */
    variant?: 'secondary' | 'quiet' | undefined
  }>

type ReaderActionBarProps = Readonly<{
  /** The single main action for the open message, e.g. "Archive". */
  primaryAction?: ReaderAction | undefined
  /** Other actions after the primary one, e.g. "Reply" and "Snooze". */
  actions?: readonly SecondaryReaderAction[] | undefined
  /** A short note at the end of the bar, e.g. that a result is local only. */
  note?: Readonly<{ title: string; detail?: string | undefined }> | undefined
  className?: string | undefined
}>

function ActionButton({
  action,
  variant,
}: Readonly<{ action: ReaderAction; variant: 'primary' | 'secondary' | 'quiet' }>) {
  const shortcut = action.disabled ? undefined : action.shortcut
  return (
    <Button
      className="reader-action-bar__action"
      variant={variant}
      disabled={action.disabled}
      aria-keyshortcuts={shortcut}
      onClick={action.onClick}
    >
      {action.icon && <Icon name={action.icon} />}
      <span className="reader-action-bar__label">{action.label}</span>
      {/* aria-keyshortcuts announces the key, so the hint stays out of the name. */}
      {shortcut && (
        <span className="reader-action-bar__hint" aria-hidden="true">
          <KeyboardHint>{shortcut}</KeyboardHint>
        </span>
      )}
    </Button>
  )
}

/**
 * The action footer of the reader: one optional primary action, other
 * actions, and an optional note, from the source's `.reader-actions`.
 *
 * Presentational only. The caller owns every action, its enabled state and its
 * keyboard shortcut; the bar handles no keys and changes no mail. Buttons wrap
 * to new lines instead of overflowing, and in a narrow container they share
 * the width and the note moves under them.
 *
 * @example
 * import { ReaderActionBar } from '../components/molecules/ReaderActionBar/ReaderActionBar'
 *
 * <ReaderActionBar
 *   primaryAction={{ label: 'Archive', icon: 'check', shortcut: 'E', onClick: archive }}
 *   actions={[{ label: 'Reply', onClick: reply }]}
 *   note={{ title: 'Local status', detail: 'Archived in this app; mailbox unchanged.' }}
 * />
 */
export function ReaderActionBar({
  primaryAction,
  actions = [],
  note,
  className,
}: ReaderActionBarProps) {
  if (!primaryAction && actions.length === 0 && !note) return null
  const classes = ['reader-action-bar', className].filter(Boolean).join(' ')
  return (
    <div className={classes}>
      <div className="reader-action-bar__row">
        {primaryAction && <ActionButton action={primaryAction} variant="primary" />}
        {actions.map((action) => (
          <ActionButton
            key={action.label}
            action={action}
            variant={action.variant ?? 'secondary'}
          />
        ))}
        {note && (
          <p className="reader-action-bar__note">
            <strong className="reader-action-bar__note-title">{note.title}</strong>
            {note.detail && <> {note.detail}</>}
          </p>
        )}
      </div>
    </div>
  )
}
