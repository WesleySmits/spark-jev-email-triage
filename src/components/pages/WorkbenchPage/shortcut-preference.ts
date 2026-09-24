/**
 * Whether the single-key shortcuts are on, kept in this browser only. One
 * flag under one key is stored: no mailbox, message, subject or body ever
 * reaches storage from here. A storage that cannot be read or written leaves
 * the keys at their default, so this stays a preference and never a barrier.
 *
 * It is a store, not a value: every reader of this browser follows the same
 * choice, another tab of it included.
 */
const key = 'spark:single-key-shortcuts:v1'

/** The keys are on until someone turns them off here. */
export const shortcutsOnByDefault = true

/** The stored choice, or the default when nothing readable is stored. */
export function storedShortcutsOn(): boolean {
  try {
    const stored = localStorage.getItem(key)
    if (stored === 'on') return true
    if (stored === 'off') return false
    return shortcutsOnByDefault
  } catch {
    return shortcutsOnByDefault
  }
}

const listeners = new Set<() => void>()

/**
 * Calls `listener` whenever the choice changes, here or in another tab, and
 * returns the way to stop. It reads nothing itself: the listener asks
 * `storedShortcutsOn` for the current choice.
 */
export function watchShortcutsOn(listener: () => void): () => void {
  listeners.add(listener)
  window.addEventListener('storage', listener)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', listener)
  }
}

/**
 * Remembers the choice for the next visit and tells this tab's readers. A
 * storage event carries it to the other tabs; nothing here waits for that.
 */
export function storeShortcutsOn(on: boolean): void {
  try {
    localStorage.setItem(key, on ? 'on' : 'off')
  } catch {
    // Whoever asks still gets the default; the page says what it does.
  }
  for (const listener of listeners) listener()
}
