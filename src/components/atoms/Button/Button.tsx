import type { ComponentPropsWithRef } from 'react'
import './Button.css'

type ButtonProps = ComponentPropsWithRef<'button'> & {
  /** Primary is the single main action on a screen. Defaults to primary. */
  variant?: 'primary' | 'secondary' | 'quiet'
}

/**
 * A native button. `type` defaults to "button" so it never submits a form by
 * accident; pass `type="submit"` when it should.
 */
export function Button({ variant = 'primary', type = 'button', className, ...props }: ButtonProps) {
  const classes = ['button', `button--${variant}`, className].filter(Boolean).join(' ')
  return <button {...props} type={type} className={classes} />
}
