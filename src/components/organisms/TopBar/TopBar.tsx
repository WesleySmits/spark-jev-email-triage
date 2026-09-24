import type { ReactNode } from 'react'
import { Avatar } from '../../atoms/Avatar/Avatar'
import { Brand } from '../../molecules/Brand/Brand'
import { SearchField } from '../../molecules/SearchField/SearchField'
import {
  SyncStatusButton,
  SyncStatusText,
  type SyncStatus,
} from '../../molecules/SyncStatusButton/SyncStatusButton'
import './TopBar.css'

type TopBarProps = Readonly<{
  /** Brand wordmark. Defaults to "Spark Triage". */
  productName?: string | undefined
  /**
   * An optional control before the brand, e.g. the button that opens the
   * filters where a navigation rail is hidden. The bar only places it: the
   * caller owns what it is, what it does and at which widths it shows.
   */
  filters?: ReactNode | undefined
  /** Accessible name of the search field, e.g. "Zoek in huidige resultaten". */
  searchLabel: string
  searchPlaceholder?: string | undefined
  /** The query. The caller owns this state. */
  searchValue: string
  /** Called with the new query on every edit. */
  onSearchChange: (value: string) => void
  /** Called with the query on Enter. The page does not navigate. */
  onSearchSubmit: (value: string) => void
  /**
   * Shows the `/` hint and sets `aria-keyshortcuts`. The bar does not listen
   * for the key: the caller focuses the field, e.g. through `searchId`.
   * Defaults to true.
   */
  searchShortcut?: boolean | undefined
  /** `id` of the search input, so the caller can focus it or point a label at it. */
  searchId?: string | undefined
  /** Disables the search, e.g. while there is no mail to search. */
  searchDisabled?: boolean | undefined
  /** Sets the sync dot and text color. */
  syncStatus: SyncStatus
  /** Visible sync text, e.g. "Updated at 09:42 · read only". */
  syncLabel: string
  /**
   * The sync button's accessible name when it should say what a click does,
   * e.g. "Refresh mail · Updated at 09:42 · read only". Keep `syncLabel` in
   * it, so voice control users can say what they see. Left out, the name is
   * `syncLabel`.
   */
  syncActionLabel?: string | undefined
  /**
   * What the sync button does is up to the caller, e.g. show details or
   * reconnect. Left out, the status shows as plain text instead of a button.
   */
  onSyncClick?: (() => void) | undefined
  /** Names the avatar, e.g. "Profiel Wesley Smits". */
  profileLabel: string
  /** One or two letters, e.g. "WS". */
  profileInitials: string
  className?: string | undefined
}>

type LeadProps = Pick<TopBarProps, 'productName' | 'filters'>

/** The brand, with the caller's optional control before it. */
function leadElement({ productName, filters }: LeadProps) {
  return (
    <div className="top-bar__lead">
      {filters}
      <Brand name={productName} className="top-bar__brand" />
    </div>
  )
}

type SearchProps = Pick<
  TopBarProps,
  | 'searchId'
  | 'searchLabel'
  | 'searchPlaceholder'
  | 'searchShortcut'
  | 'searchValue'
  | 'searchDisabled'
  | 'onSearchChange'
  | 'onSearchSubmit'
>

/** The search landmark. Enter submits the query without navigating. */
function searchElement({
  searchId,
  searchLabel,
  searchPlaceholder,
  searchShortcut,
  searchValue,
  searchDisabled,
  onSearchChange,
  onSearchSubmit,
}: SearchProps) {
  return (
    <form
      className="top-bar__search"
      role="search"
      onSubmit={(event) => {
        event.preventDefault()
        onSearchSubmit(searchValue)
      }}
    >
      <SearchField
        id={searchId}
        label={searchLabel}
        placeholder={searchPlaceholder}
        shortcut={searchShortcut}
        value={searchValue}
        disabled={searchDisabled}
        onChange={(event) => {
          onSearchChange(event.target.value)
        }}
      />
    </form>
  )
}

type SyncProps = Pick<TopBarProps, 'syncStatus' | 'syncLabel' | 'syncActionLabel' | 'onSyncClick'>

/** The sync status: a button when a click does something, plain text otherwise. */
function syncElement({ syncStatus, syncLabel, syncActionLabel, onSyncClick }: SyncProps) {
  if (!onSyncClick) {
    return (
      <SyncStatusText status={syncStatus} className="top-bar__sync">
        {syncLabel}
      </SyncStatusText>
    )
  }
  return (
    <SyncStatusButton
      status={syncStatus}
      className="top-bar__sync"
      aria-label={syncActionLabel}
      onClick={onSyncClick}
    >
      {syncLabel}
    </SyncStatusButton>
  )
}

/**
 * The product top bar from the Compact workbench: brand, current-result
 * search, sync status and profile avatar.
 *
 * Presentational only. The caller owns the query, what submit and the sync
 * button do, and all copy. It renders a `header`, which is the page's banner
 * landmark when it is not inside `main` or a sectioning element, and wraps the
 * search in a search landmark. The avatar is an image, not an account menu.
 * Below a 600px viewport the search moves to its own full-width row and the
 * search and sync controls grow to 44px. A `filters` control shares the
 * brand's column, so it is the first thing Tab reaches.
 *
 * @example
 * import { TopBar } from '../components/organisms/TopBar/TopBar'
 *
 * <TopBar
 *   searchLabel="Zoek in huidige resultaten"
 *   searchPlaceholder="Zoek in huidige resultaten"
 *   searchValue={query}
 *   onSearchChange={setQuery}
 *   onSearchSubmit={runSearch}
 *   syncStatus="connected"
 *   syncLabel="Updated at 09:42 · read only"
 *   syncActionLabel="Refresh mail · Updated at 09:42 · read only"
 *   onSyncClick={refresh}
 *   profileLabel="Profiel Wesley Smits"
 *   profileInitials="WS"
 * />
 */
export function TopBar({ profileLabel, profileInitials, className, ...props }: TopBarProps) {
  const classes = ['top-bar', className].filter(Boolean).join(' ')
  return (
    <header className={classes}>
      {leadElement(props)}
      {searchElement(props)}
      {syncElement(props)}
      <Avatar initials={profileInitials} label={profileLabel} size="sm" />
    </header>
  )
}
