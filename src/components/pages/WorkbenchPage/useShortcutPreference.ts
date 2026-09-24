import { useSyncExternalStore } from 'react'
import {
  shortcutsOnByDefault,
  storedShortcutsOn,
  storeShortcutsOn,
  watchShortcutsOn,
} from './shortcut-preference'

/** A server render cannot see this browser's storage, so it shows the default. */
const onByDefault = () => shortcutsOnByDefault

/**
 * The single-key shortcut preference of this browser: whether the keys are
 * on, and how to change it. The stored choice applies as soon as the page is
 * the browser's, a reload and another tab included. What the keys then do is
 * up to `useWorkbenchShortcuts`; what they say they do is up to the legend
 * and the hints.
 */
export function useShortcutPreference() {
  const on = useSyncExternalStore(watchShortcutsOn, storedShortcutsOn, onByDefault)
  return {
    on,
    /** Applies the choice now and remembers it for the next visit. */
    choose: storeShortcutsOn,
  } as const
}
