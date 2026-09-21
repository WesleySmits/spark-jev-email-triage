import type { ComponentPropsWithoutRef } from 'react'
import './Checkbox.css'

type CheckboxProps = Omit<ComponentPropsWithoutRef<'input'>, 'type' | 'children'> & {
  /** Accessible name. Also the visible text unless `hideLabel` is set. */
  label: string
  /** Keep the name for assistive technology but show only the box, for example in a list row. */
  hideLabel?: boolean | undefined
  /** Some but not all of a group is selected. The browser clears it when the user clicks. */
  indeterminate?: boolean | undefined
}

/**
 * A native checkbox inside a label with a 44px touch target.
 *
 * @example
 * import { Checkbox } from '../components/atoms/Checkbox/Checkbox'
 *
 * <Checkbox label="Select visible results" indeterminate />
 * <Checkbox label="Select Invoice March" hideLabel />
 */
export function Checkbox({
  label,
  hideLabel = false,
  indeterminate = false,
  className,
  ...props
}: CheckboxProps) {
  const classes = ['checkbox', className].filter(Boolean).join(' ')
  return (
    <label className={classes}>
      <input
        {...props}
        className="checkbox__input"
        type="checkbox"
        ref={(input) => {
          if (input) input.indeterminate = indeterminate
        }}
      />
      <span className={hideLabel ? 'checkbox__label checkbox__label--hidden' : 'checkbox__label'}>
        {label}
      </span>
    </label>
  )
}
