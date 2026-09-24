import { useEffect, useLayoutEffect, useRef } from 'react'

export type WorkbenchShortcut = 'next' | 'previous' | 'complete' | 'search'

// A Map, so keys such as "constructor" don't find Object.prototype members.
const shortcuts: ReadonlyMap<string, WorkbenchShortcut> = new Map([
  ['k', 'next'],
  ['j', 'previous'],
  ['e', 'complete'],
  ['/', 'search'],
])

export type LegendShortcut = Readonly<{
  label: string
  keys: readonly [string, ...string[]]
}>

/** What the rail's legend shows. The search field shows `/` itself. */
export const shortcutLegend: readonly LegendShortcut[] = [
  { label: 'Next / previous', keys: ['K', 'J'] },
  { label: 'Complete', keys: ['E'] },
]

/**
 * The legend rows to show: none while the keys are off, so the help never
 * offers a key that does nothing, and Complete only where it is offered.
 */
export function legendFor(
  options: Readonly<{ singleKeys: boolean; canComplete: boolean }>,
): readonly LegendShortcut[] {
  if (!options.singleKeys) return []
  if (options.canComplete) return shortcutLegend
  return shortcutLegend.filter((item) => item.label !== 'Complete')
}

// Controls and fields that own their keys: text entry, buttons, checkboxes,
// links and ARIA widgets. A key pressed on one of them is left to it.
const interactive = [
  'input',
  'textarea',
  'select',
  'button',
  'a[href]',
  'summary',
  '[contenteditable]:not([contenteditable="false"])',
  ...[
    'button',
    'link',
    'checkbox',
    'radio',
    'switch',
    'textbox',
    'searchbox',
    'combobox',
    'listbox',
    'option',
    'menuitem',
    'menuitemcheckbox',
    'menuitemradio',
    'slider',
    'spinbutton',
    'tab',
  ].map((role) => `[role="${role}"]`),
].join(', ')

export type ShortcutContext = Readonly<{
  /** The controls the keys still act from, e.g. the queue's rows. */
  actsFrom?: string | undefined
  /**
   * Whether the shortcuts that are one character long are on. Off, a bare
   * letter or `/` means nothing anywhere on the page, while keys the browser
   * and the controls own, such as Tab, Enter and Escape, are untouched.
   * Defaults to on.
   */
  singleKeys?: boolean | undefined
}>

type KeyEvent = Pick<
  KeyboardEvent,
  'key' | 'altKey' | 'ctrlKey' | 'metaKey' | 'defaultPrevented' | 'isComposing' | 'target'
>

/** Duck-typed, so the check also runs outside a browser. */
function matches(target: EventTarget | null, selector: string) {
  const element = target as Partial<Pick<Element, 'closest'>> | null
  return Boolean(element?.closest?.(selector))
}

/** Whether a key pressed on `target` belongs to that control, not to the page. */
function ownsKeys(target: EventTarget | null, actsFrom: string | undefined) {
  if (!matches(target, interactive)) return false
  const element = target as Partial<Pick<Element, 'matches'>> | null
  return !(actsFrom && element?.matches?.(actsFrom))
}

/**
 * The shortcut a key press means, or null. Keys pressed on a field, button,
 * checkbox, link or other control, presses with Ctrl, Alt or Cmd, IME
 * composition and presses something else already handled mean nothing, so
 * typing, controls and browser shortcuts keep working. With `singleKeys`
 * off, a press of one character means nothing either.
 */
export function shortcutFor(
  event: KeyEvent,
  { actsFrom, singleKeys = true }: ShortcutContext = {},
): WorkbenchShortcut | null {
  const modified = event.altKey || event.ctrlKey || event.metaKey
  if (modified || event.defaultPrevented || event.isComposing) return null
  if (!singleKeys && event.key.length === 1) return null
  if (ownsKeys(event.target, actsFrom)) return null
  // Shift and Caps Lock give capitals; K, J and E mean the same.
  return shortcuts.get(event.key.length === 1 ? event.key.toLowerCase() : event.key) ?? null
}

/**
 * Listens on the document while mounted and calls the matching handler. The
 * handlers may change on every render; the listener always calls the latest.
 * A layout effect updates them before the browser can deliver another key,
 * so a press never reaches the handlers of the previous render. `context` is
 * passed to `shortcutFor`: with `singleKeys` off nothing listens at all.
 */
export function useWorkbenchShortcuts(
  handlers: Readonly<Record<WorkbenchShortcut, () => void>>,
  { actsFrom, singleKeys = true }: ShortcutContext = {},
) {
  const latest = useRef(handlers)
  useLayoutEffect(() => {
    latest.current = handlers
  })
  useEffect(() => {
    if (!singleKeys) return
    const onKeyDown = (event: KeyboardEvent) => {
      const shortcut = shortcutFor(event, { actsFrom, singleKeys })
      if (!shortcut) return
      event.preventDefault()
      latest.current[shortcut]()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [actsFrom, singleKeys])
}
