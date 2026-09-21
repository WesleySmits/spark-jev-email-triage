import type { ComponentPropsWithoutRef } from 'react'
import { Icon } from '../Icon/Icon'
import './SearchInput.css'

type SearchInputProps = Omit<ComponentPropsWithoutRef<'input'>, 'type' | 'children'> & {
  /** Accessible name. The placeholder is only a hint, never the label. */
  label: string
}

/**
 * A native search field with the search icon. It fills its container's width.
 *
 * @example
 * import { SearchInput } from '../components/atoms/SearchInput/SearchInput'
 *
 * <SearchInput label="Search current results" placeholder="Search current results" />
 */
export function SearchInput({ label, className, ...props }: SearchInputProps) {
  const classes = ['search-input', className].filter(Boolean).join(' ')
  return (
    <label className={classes}>
      <Icon name="search" size="sm" />
      <input {...props} className="search-input__field" type="search" aria-label={label} />
    </label>
  )
}
