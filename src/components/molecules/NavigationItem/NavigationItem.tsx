import type { ComponentProps, ComponentPropsWithRef } from 'react'
import { AccountMarker } from '../../atoms/AccountMarker/AccountMarker'
import { Icon } from '../../atoms/Icon/Icon'
import './NavigationItem.css'

/** Either an icon or an account marker leads the row, never both. */
type Lead =
  | { icon: ComponentProps<typeof Icon>['name']; account?: undefined }
  | { account: ComponentProps<typeof AccountMarker>['account']; icon?: undefined }

type NavigationItemProps = Omit<
  ComponentPropsWithRef<'button'>,
  'type' | 'children' | 'aria-pressed' | 'aria-label' | 'aria-labelledby'
> &
  Lead & {
    /** Visible text and accessible name. Truncated with an ellipsis when narrow. */
    label: string
    /** Optional number of matching items, shown at the end in tabular figures. */
    count?: number | undefined
    /** Whether this filter is applied. Exposed as `aria-pressed`. */
    active?: boolean | undefined
  }

/**
 * A 36px filter row for the navigation rail: a native toggle button with an
 * icon or account marker, a label and an optional count. The caller owns the
 * filter state and the click behavior.
 *
 * @example
 * import { NavigationItem } from '../components/molecules/NavigationItem/NavigationItem'
 *
 * <NavigationItem icon="clock" label="Needs review" count={3} active={filter === 'review'} onClick={() => setFilter('review')} />
 * <NavigationItem account="studio" label="Studio Noord" count={4} active={account === 'studio'} onClick={() => setAccount('studio')} />
 */
export function NavigationItem({
  icon,
  account,
  label,
  count,
  active = false,
  className,
  ...props
}: NavigationItemProps) {
  const classes = ['navigation-item', className].filter(Boolean).join(' ')
  return (
    <button {...props} type="button" aria-pressed={active} className={classes}>
      {icon ? <Icon name={icon} size="sm" /> : <AccountMarker account={account} />}
      <span className="navigation-item__label">{label}</span>
      {count !== undefined && <span className="navigation-item__count">{count}</span>}
    </button>
  )
}
