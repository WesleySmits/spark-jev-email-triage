import { useEffect, useRef, type RefObject } from 'react'

export type InboxReadFocus = 'view-unread' | 'view-other' | 'load-older' | 'refresh'

const selectorFor = (target: InboxReadFocus) =>
  target === 'refresh' ? '.top-bar__sync' : `[data-inbox-read-focus="${target}"]`

/** Restore only focus lost by a read; never steal focus the person moved elsewhere. */
function restoreInboxReadFocus(root: HTMLElement | null, target: InboxReadFocus) {
  const active = document.activeElement
  if (active instanceof HTMLElement && active !== document.body && active.isConnected) return
  const exact = root?.querySelector<HTMLElement>(selectorFor(target))
  const fallback =
    root?.querySelector<HTMLElement>('[data-inbox-read-focus][aria-current="page"]') ??
    root?.querySelector<HTMLElement>('.top-bar__sync')
  ;(exact ?? fallback)?.focus()
}

/** Remember the initiating read control across disabled and remounted states. */
export function useInboxReadFocus(root: RefObject<HTMLElement | null>, loading: boolean) {
  const pending = useRef<InboxReadFocus | null>(null)
  const readWasLoading = useRef(false)
  useEffect(() => {
    if (loading) {
      readWasLoading.current = true
      return
    }
    if (!readWasLoading.current) return
    readWasLoading.current = false
    const target = pending.current
    pending.current = null
    if (!target) return
    const frame = window.requestAnimationFrame(() => {
      restoreInboxReadFocus(root.current, target)
    })
    return () => {
      window.cancelAnimationFrame(frame)
    }
  }, [loading, root])
  return (target: InboxReadFocus) => {
    pending.current = target
  }
}
