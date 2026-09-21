import type { ComponentProps, ComponentPropsWithRef } from 'react'
import { Button } from '../Button/Button'
import { Icon } from '../Icon/Icon'
import './IconButton.css'

type IconButtonProps = Omit<
  ComponentPropsWithRef<'button'>,
  'children' | 'aria-label' | 'aria-labelledby'
> & {
  /** The icon to show. It is decorative; `label` names the button. */
  icon: ComponentProps<typeof Icon>['name']
  /** Accessible name. Required because the button has no visible text. */
  label: string
  /** Quiet is transparent, as in the source reader bar. Defaults to quiet. */
  variant?: 'quiet' | 'secondary'
}

/**
 * A native icon-only button with a 44px target. It is a `Button`, so `type`
 * defaults to "button" and focus, hover and disabled states are shared.
 *
 * @example
 * import { IconButton } from '../components/atoms/IconButton/IconButton'
 *
 * <IconButton icon="back" label="Back to messages" onClick={onBack} />
 */
export function IconButton({
  icon,
  label,
  variant = 'quiet',
  className,
  ...props
}: IconButtonProps) {
  const classes = ['icon-button', className].filter(Boolean).join(' ')
  return (
    <Button {...props} variant={variant} aria-label={label} className={classes}>
      <Icon name={icon} />
    </Button>
  )
}
