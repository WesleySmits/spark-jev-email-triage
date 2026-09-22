import { useEffect, useRef } from 'react'

export type WorkbenchShortcut = 'next' | 'previous' | 'complete' | 'search'

// A Map, so keys such as "constructor" don't find Object.prototype members.
const shortcuts: ReadonlyMap<string, WorkbenchShortcut> = new Map([
  ['j', 'next'],
  ['k', 'previous'],
  ['e', 'complete'],
  ['/', 'search'],
])

/** What the rail's legend shows. The search field shows `/` itself. */
export const shortcutLegend = [
  { label: 'Next / previous', keys: ['J', 'K'] },
  { label: 'Complete', keys: ['E'] },
] as const

// Fields where the keys type text. Checkboxes and buttons still take shortcuts.
const textEntry =
  'input:not([type="checkbox"], [type="radio"], [type="button"], [type="submit"], [type="reset"]), textarea, select, [contenteditable]:not([contenteditable="false"])'

type KeyEvent = Pick<
  KeyboardEvent,
  'key' | 'altKey' | 'ctrlKey' | 'metaKey' | 'defaultPrevented' | 'isComposing' | 'target'
>

/** Duck-typed, so the check also runs outside a browser. */
function typesText(target: EventTarget | null) {
  const element = target as Partial<Pick<Element, 'closest'>> | null
  return Boolean(element?.closest?.(textEntry))
}

/**
 * The shortcut a key press means, or null. Keys typed into a text field,
 * presses with Ctrl, Alt or Cmd, IME composition and presses something else
 * already handled mean nothing, so typing and browser shortcuts keep working.
 */
export function shortcutFor(event: KeyEvent): WorkbenchShortcut | null {
  const modified = event.altKey || event.ctrlKey || event.metaKey
  if (modified || event.defaultPrevented || event.isComposing || typesText(event.target)) {
    return null
  }
  return shortcuts.get(event.key) ?? null
}

/**
 * Listens on the document while mounted and calls the matching handler. The
 * handlers may change on every render; the listener always calls the latest.
 */
export function useWorkbenchShortcuts(handlers: Readonly<Record<WorkbenchShortcut, () => void>>) {
  const latest = useRef(handlers)
  useEffect(() => {
    latest.current = handlers
  })
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const shortcut = shortcutFor(event)
      if (!shortcut) return
      event.preventDefault()
      latest.current[shortcut]()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [])
}
