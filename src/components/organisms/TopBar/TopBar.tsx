import { Avatar } from '../../atoms/Avatar/Avatar'
import { Brand } from '../../molecules/Brand/Brand'
import { SearchField } from '../../molecules/SearchField/SearchField'
import { SyncStatusButton } from '../../molecules/SyncStatusButton/SyncStatusButton'
import './TopBar.css'

type TopBarProps = Readonly<{
  /** Brand wordmark. Defaults to "Spark Triage". */
  productName?: string | undefined
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
  /** Sets the sync dot and text color. */
  syncStatus: 'connected' | 'disconnected'
  /** Visible sync text and the button's name, e.g. "Bijgewerkt 2 min geleden". */
  syncLabel: string
  /** What the sync button does is up to the caller, e.g. show details or reconnect. */
  onSyncClick: () => void
  /** Names the avatar, e.g. "Profiel Wesley Smits". */
  profileLabel: string
  /** One or two letters, e.g. "WS". */
  profileInitials: string
  className?: string | undefined
}>

/**
 * The product top bar from the Compact workbench: brand, current-result
 * search, sync status and profile avatar.
 *
 * Presentational only. The caller owns the query, what submit and the sync
 * button do, and all copy. It renders a `header`, which is the page's banner
 * landmark when it is not inside `main` or a sectioning element, and wraps the
 * search in a search landmark. The avatar is an image, not an account menu.
 * Below a 600px viewport the search moves to its own full-width row and the
 * search and sync controls grow to 44px.
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
 *   syncLabel="Bijgewerkt 2 min geleden"
 *   onSyncClick={showSyncDetails}
 *   profileLabel="Profiel Wesley Smits"
 *   profileInitials="WS"
 * />
 */
export function TopBar({
  productName,
  searchLabel,
  searchPlaceholder,
  searchValue,
  onSearchChange,
  onSearchSubmit,
  searchShortcut,
  searchId,
  syncStatus,
  syncLabel,
  onSyncClick,
  profileLabel,
  profileInitials,
  className,
}: TopBarProps) {
  const classes = ['top-bar', className].filter(Boolean).join(' ')
  return (
    <header className={classes}>
      <Brand name={productName} className="top-bar__brand" />
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
          onChange={(event) => {
            onSearchChange(event.target.value)
          }}
        />
      </form>
      <SyncStatusButton status={syncStatus} className="top-bar__sync" onClick={onSyncClick}>
        {syncLabel}
      </SyncStatusButton>
      <Avatar initials={profileInitials} label={profileLabel} size="sm" />
    </header>
  )
}
