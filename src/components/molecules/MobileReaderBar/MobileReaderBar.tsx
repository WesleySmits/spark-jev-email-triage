import { IconButton } from '../../atoms/IconButton/IconButton'
import './MobileReaderBar.css'

type MobileReaderBarProps = Readonly<{
  /** The open message's mailbox or scope, e.g. "Studio Noord". */
  title: string
  /** Position within the queue, already formatted, e.g. "1 of 3 in Needs review". */
  context?: string | undefined
  /** Returns to the message list. The caller owns the navigation. */
  onBack: () => void
  /** Accessible name of the back button. Defaults to "Back to messages". */
  backLabel?: string | undefined
  /** Opens more options. Without it the end slot stays empty, so the text stays centered. */
  onMoreOptions?: (() => void) | undefined
  /** Accessible name of the more options button. Defaults to "More options". */
  moreOptionsLabel?: string | undefined
  /** Set when the button opens a menu or panel the caller shows and hides. */
  moreOptionsExpanded?: boolean | undefined
  className?: string | undefined
}>

/**
 * The 48px contextual bar above the reader on mobile: back, the open
 * message's context, and more options.
 *
 * Presentational only. The caller formats the copy and handles both buttons.
 * It renders a `div`, not a landmark or heading; the reader's own heading
 * names the message. The text wraps instead of truncating.
 *
 * @example
 * import { MobileReaderBar } from '../components/molecules/MobileReaderBar/MobileReaderBar'
 *
 * <MobileReaderBar
 *   title="Studio Noord"
 *   context="1 of 3 in Needs review"
 *   onBack={showList}
 *   onMoreOptions={toggleMenu}
 *   moreOptionsExpanded={menuOpen}
 * />
 */
export function MobileReaderBar({
  title,
  context,
  onBack,
  backLabel = 'Back to messages',
  onMoreOptions,
  moreOptionsLabel = 'More options',
  moreOptionsExpanded,
  className,
}: MobileReaderBarProps) {
  const classes = ['mobile-reader-bar', className].filter(Boolean).join(' ')
  return (
    <div className={classes}>
      <IconButton icon="back" label={backLabel} onClick={onBack} />
      <p className="mobile-reader-bar__text">
        <strong className="mobile-reader-bar__title">{title}</strong>
        {context && <span className="mobile-reader-bar__context">{context}</span>}
      </p>
      {onMoreOptions && (
        <IconButton
          icon="more"
          label={moreOptionsLabel}
          aria-expanded={moreOptionsExpanded}
          onClick={onMoreOptions}
        />
      )}
    </div>
  )
}
