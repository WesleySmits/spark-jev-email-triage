import { useEffect, useState, useSyncExternalStore } from 'react'
import {
  createReconnect,
  type ConnectionReason,
  type ReconnectEnvironment,
  type ReconnectOptions,
} from '../../../app/reconnect'

/** The page's own timers, visibility and network state. Read only when called. */
const browser: ReconnectEnvironment = {
  visible: () => document.visibilityState === 'visible',
  online: () => navigator.onLine,
  now: () => new Date(),
  setTimeout: (run, ms) => window.setTimeout(run, ms),
  clearTimeout: (timer) => {
    window.clearTimeout(timer as number)
  },
}

type UseReconnectOptions = Readonly<
  Pick<ReconnectOptions, 'probe' | 'load' | 'intervalMs'> & {
    /** Why the page waits now. A new reason, e.g. after an inbox read, is taken on. */
    reason: ConnectionReason
  }
>

/**
 * Runs the reconnect rules of `app/reconnect.ts` while the component is
 * mounted: it starts on mount, follows the page's visibility, focus and
 * network events, and stops, aborting a running check, on unmount.
 * Returns the current state and Check now.
 */
export function useReconnect({ reason, probe, load, intervalMs }: UseReconnectOptions) {
  const [reconnect] = useState(() =>
    createReconnect({ reason, probe, load, environment: browser, intervalMs }),
  )
  // The latest callbacks, so a new function from the caller needs no restart.
  useEffect(() => {
    reconnect.update({ probe, load })
  })
  const state = useSyncExternalStore(
    reconnect.subscribe,
    reconnect.getSnapshot,
    reconnect.getSnapshot,
  )

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'visible') reconnect.wake()
      else reconnect.pause()
    }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('focus', reconnect.wake)
    window.addEventListener('online', reconnect.wake)
    window.addEventListener('offline', reconnect.pause)
    reconnect.start()
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('focus', reconnect.wake)
      window.removeEventListener('online', reconnect.wake)
      window.removeEventListener('offline', reconnect.pause)
      reconnect.stop()
    }
  }, [reconnect])

  useEffect(() => {
    reconnect.setReason(reason)
  }, [reconnect, reason])

  return { state, checkNow: reconnect.checkNow } as const
}
