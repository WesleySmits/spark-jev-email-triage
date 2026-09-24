import { useEffect, useRef, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'
import { IconButton } from '../../atoms/IconButton/IconButton'
import './FilterSheet.css'

type FilterSheetProps = Readonly<{
  /** Names the dialog and heads it, e.g. "Filters". */
  label: string
  /** Whether the sheet is open. The caller owns this state. */
  open: boolean
  /**
   * Called for every way out: Escape, the close button and the backdrop. The
   * caller closes the sheet by passing `open={false}`; nothing closes on its
   * own.
   */
  onClose: () => void
  /** Accessible name of the close button. Defaults to "Close" plus the label. */
  closeLabel?: string | undefined
  /** What the sheet holds, usually the page's Sidebar. */
  children: ReactNode
  className?: string | undefined
}>

/**
 * A modal side panel for the filters where the navigation rail is hidden.
 *
 * It is a native `dialog` opened with `showModal`, so the browser owns what
 * keyboard users expect: focus moves into the panel, stays inside it, Escape
 * closes it, and focus returns to whatever opened it. The rest of the page is
 * inert while it is open.
 *
 * Presentational only. The caller owns the state, the filters inside and what
 * a choice does; the sheet adds no filter logic of its own. It holds one
 * copy of the same filters the rail shows, so nothing here is a second
 * filter model.
 *
 * @example
 * import { FilterSheet } from '../components/organisms/FilterSheet/FilterSheet'
 *
 * <FilterSheet label="Filters" open={open} onClose={() => { setOpen(false) }}>
 *   <Sidebar label="Filters" groups={groups} onSelect={select} />
 * </FilterSheet>
 */
export function FilterSheet({
  label,
  open,
  onClose,
  closeLabel = `Close ${label.toLowerCase()}`,
  children,
  className,
}: FilterSheetProps) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])
  const classes = ['filter-sheet', className].filter(Boolean).join(' ')
  return (
    <dialog
      ref={ref}
      className={classes}
      aria-label={label}
      onClose={onClose}
      // A close request from the keyboard. A browser answers a real Escape
      // itself; answering it here too also closes the sheet where the press
      // was dispatched rather than typed, and closing twice closes once.
      onKeyDown={(event: KeyboardEvent<HTMLDialogElement>) => {
        if (event.key === 'Escape') onClose()
      }}
      // A click on the backdrop reaches the dialog itself, never its content.
      onClick={(event: MouseEvent<HTMLDialogElement>) => {
        if (event.target === ref.current) onClose()
      }}
    >
      <div className="filter-sheet__bar">
        <p className="filter-sheet__title">{label}</p>
        <IconButton icon="close" label={closeLabel} onClick={onClose} />
      </div>
      <div className="filter-sheet__body">{children}</div>
    </dialog>
  )
}
