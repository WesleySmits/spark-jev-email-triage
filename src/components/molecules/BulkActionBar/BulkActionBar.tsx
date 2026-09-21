import type { ChangeEventHandler, ComponentProps } from 'react'
import { Button } from '../../atoms/Button/Button'
import { Checkbox } from '../../atoms/Checkbox/Checkbox'
import { Icon } from '../../atoms/Icon/Icon'
import './BulkActionBar.css'

type BulkAction = Readonly<{
  /** Visible text, e.g. "Complete 3". Unique in the bar. */
  label: string
  onClick: () => void
  /**
   * Fuller accessible name when the visible text is terse, e.g.
   * "Complete 3 selected results". Start it with the visible text so voice
   * control users can say what they see.
   */
  accessibleLabel?: string | undefined
  /** Optional icon before the label. It is hidden from assistive technology. */
  icon?: ComponentProps<typeof Icon>['name'] | undefined
  /** Use primary for at most one action, and only when nothing else on screen is primary. Defaults to secondary. */
  variant?: 'primary' | 'secondary' | 'quiet' | undefined
  disabled?: boolean | undefined
}>

type SelectAll = Readonly<{
  /** Accessible name of the checkbox, e.g. "Select all visible results". It is not shown. */
  label: string
  checked: boolean
  /** Some but not all visible results are selected. */
  indeterminate?: boolean | undefined
  onChange: ChangeEventHandler<HTMLInputElement>
  disabled?: boolean | undefined
}>

type BulkActionBarProps = Readonly<{
  /** Names the group for assistive technology, e.g. "Bulk actions". */
  label: string
  /**
   * Visible selection text, already formatted and pluralized, e.g.
   * "3 results selected". With nothing selected, pass a prompt such as
   * "Select visible results" and set `hasSelection` to false.
   */
  count: string
  /** Emphasizes the count when something is selected. Defaults to true. */
  hasSelection?: boolean | undefined
  /** Scope after the count, e.g. "within current filter". */
  context?: string | undefined
  /** An optional select-all checkbox before the count. The caller owns its state. */
  selectAll?: SelectAll | undefined
  /** The caller's actions, in order. An empty list renders no action group. */
  actions?: readonly BulkAction[] | undefined
  className?: string | undefined
}>

function ActionButton({ label, onClick, accessibleLabel, icon, variant, disabled }: BulkAction) {
  return (
    <Button
      className="bulk-action-bar__action"
      variant={variant ?? 'secondary'}
      disabled={disabled}
      aria-label={accessibleLabel}
      onClick={onClick}
    >
      {icon && <Icon name={icon} size="sm" />}
      {label}
    </Button>
  )
}

/**
 * The row above a queue that shows how many results are selected and offers
 * actions for them: an optional select-all checkbox, the count with its scope,
 * and the caller's buttons.
 *
 * Presentational only. The caller owns the selection, formats the count and
 * handles every action. The count is not a live region; the checkbox and
 * buttons already announce their own state, and results of an action belong
 * in a status message elsewhere. Text and actions wrap instead of scrolling.
 *
 * @example
 * import { BulkActionBar } from '../components/molecules/BulkActionBar/BulkActionBar'
 *
 * <BulkActionBar
 *   label="Bulk actions"
 *   count="3 results selected"
 *   context="within current filter"
 *   selectAll={{ label: 'Select all visible results', checked: false, indeterminate: true, onChange }}
 *   actions={[{ label: 'Complete 3', icon: 'check', variant: 'primary', onClick: complete }]}
 * />
 */
export function BulkActionBar({
  label,
  count,
  hasSelection = true,
  context,
  selectAll,
  actions = [],
  className,
}: BulkActionBarProps) {
  const classes = ['bulk-action-bar', className].filter(Boolean).join(' ')
  const countClass = hasSelection
    ? 'bulk-action-bar__count bulk-action-bar__count--selected'
    : 'bulk-action-bar__count'
  return (
    <div role="group" aria-label={label} className={classes}>
      {selectAll && <Checkbox {...selectAll} hideLabel />}
      <p className="bulk-action-bar__summary">
        <span className={countClass}>{count}</span>
        {context && <> {context}</>}
      </p>
      {actions.length > 0 && (
        <div className="bulk-action-bar__actions">
          {actions.map((action) => (
            <ActionButton key={action.label} {...action} />
          ))}
        </div>
      )}
    </div>
  )
}
