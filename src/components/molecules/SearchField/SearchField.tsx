import type { ComponentProps } from 'react'
import { KeyboardHint } from '../../atoms/KeyboardHint/KeyboardHint'
import { SearchInput } from '../../atoms/SearchInput/SearchInput'
import './SearchField.css'

type SearchFieldProps = ComponentProps<typeof SearchInput> & {
  /**
   * Shows the `/` hint and sets `aria-keyshortcuts`. The field does not listen
   * for the key: the caller focuses it. Hidden while disabled. Defaults to true.
   */
  shortcut?: boolean | undefined
}

/**
 * The top-bar search: a SearchInput with the `/` shortcut hint at its end.
 * The hint hides while the field has focus or is narrower than 240px. It fills
 * its container's width, so give it a width in a flex row.
 *
 * @example
 * import { SearchField } from '../components/molecules/SearchField/SearchField'
 *
 * <SearchField label="Search current results" placeholder="Search current results" value={query} onChange={onQuery} />
 */
export function SearchField({ shortcut = true, className, ...props }: SearchFieldProps) {
  const showHint = shortcut && !props.disabled
  const classes = ['search-field', className].filter(Boolean).join(' ')
  return (
    <div className={classes}>
      <SearchInput
        {...props}
        {...(showHint && { 'aria-keyshortcuts': '/' })}
        className={
          showHint ? 'search-field__input search-field__input--hint' : 'search-field__input'
        }
      />
      {showHint && (
        <span className="search-field__hint" aria-hidden="true">
          <KeyboardHint>/</KeyboardHint>
        </span>
      )}
    </div>
  )
}
