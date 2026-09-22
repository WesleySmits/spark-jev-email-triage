/**
 * A cheap, read-only check of whether Spark answers: one mailbox listing,
 * which is `spark accounts`, instead of the full inbox read. The page polls
 * it while Spark is away and reads the inbox only once it says ready.
 *
 * Nothing it learns leaves this module: the listing is dropped, and the
 * answer holds only a status and a coarse reason.
 */
import type { MailReader } from '../domain/mail-reader'
import { reasonFor } from './live-inbox.server'
import type { SparkReadiness } from './spark-readiness'

/** How long one probe may take before it counts as failed. */
export const probeTimeoutMs = 5_000
/** How long a settled answer is reused, e.g. by a second tab. */
export const reuseMs = 2_000

export interface SparkReadinessOptions {
  reader: MailReader
  timeoutMs?: number | undefined
  reuseMs?: number | undefined
  now?: (() => number) | undefined
}

const unavailable = (error: unknown): SparkReadiness => ({
  status: 'unavailable',
  reason: reasonFor(error),
})

/** Rejects after `ms`, and aborts `controller` so the call stops too. */
function deadline(ms: number, controller: AbortController) {
  let timer: ReturnType<typeof setTimeout> | undefined
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort()
      reject(new Error('The readiness probe timed out'))
    }, ms)
  })
  return {
    expired,
    clear: () => {
      clearTimeout(timer)
    },
  } as const
}

/**
 * The readiness probe. Probes that arrive while one runs share it, so Spark
 * is asked at most once at a time, and a settled answer is reused for
 * `reuseMs`. It never takes a caller's signal: a shared probe must not stop
 * because one caller left. The timeout bounds it instead.
 */
export function createSparkReadiness({
  reader,
  timeoutMs = probeTimeoutMs,
  reuseMs: reuse = reuseMs,
  now = Date.now,
}: SparkReadinessOptions) {
  let running: Promise<SparkReadiness> | undefined
  let settled: Readonly<{ at: number; answer: SparkReadiness }> | undefined

  const ask = async (): Promise<SparkReadiness> => {
    const controller = new AbortController()
    const limit = deadline(timeoutMs, controller)
    try {
      // The listing is only proof that Spark answered; none of it is kept.
      await Promise.race([reader.listMailboxes({ signal: controller.signal }), limit.expired])
      return { status: 'ready' }
    } catch (error) {
      return unavailable(error)
    } finally {
      limit.clear()
    }
  }

  return {
    probe(): Promise<SparkReadiness> {
      if (running) return running
      if (settled && now() - settled.at < reuse) return Promise.resolve(settled.answer)
      const current = ask().then((answer) => {
        settled = { at: now(), answer }
        return answer
      })
      running = current
      void current.finally(() => {
        if (running === current) running = undefined
      })
      return current
    },
  } as const
}

type Readiness = ReturnType<typeof createSparkReadiness>

/**
 * The answer for one request. A request from another computer is refused
 * before Spark is asked anything.
 */
export function readinessFor(fromThisComputer: boolean, readiness: () => Readiness) {
  if (!fromThisComputer) {
    return Promise.resolve<SparkReadiness>({ status: 'unavailable', reason: 'local-only' })
  }
  return readiness().probe()
}
