/**
 * The `pnpm readback:spark` command: does Spark answer on this computer,
 * right now.
 *
 * It is deliberately apart from the health endpoint. Health says which
 * commit is deployed and nothing more; this says whether the mail provider
 * answers and nothing more. A release reports both, separately, because one
 * is never evidence for the other: a healthy build with no Spark reads no
 * mail, and a reachable Spark says nothing about what is deployed.
 *
 * It reads: one mailbox listing, which is `spark accounts`, through the same
 * probe the app uses. The listing is proof that Spark answered and is then
 * dropped, so no address, subject, count or body is ever kept or printed.
 * Output is one line: a status and, where it failed, a coarse reason.
 */
import type { SparkReadiness } from '../app/spark-readiness'
import { createSparkReadiness } from '../app/spark-readiness.server'
import { createProcessTransport } from '../spark/process'
import { createSparkMailReader } from '../spark/reader'

export const exitCodes = { ok: 0, unavailable: 1, usage: 64 } as const

const usage = 'usage: pnpm readback:spark'

/** One readiness answer, however it was obtained. */
export type SparkProbe = () => Promise<SparkReadiness>

/** The probe over the local Spark CLI, read-only and logging nothing. */
function liveSparkProbe(): SparkProbe {
  const readiness = createSparkReadiness({
    reader: createSparkMailReader({
      transport: createProcessTransport(),
      // Spark Desktop prints times in the zone of the Mac it runs on.
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      log: () => undefined,
    }),
  })
  return () => readiness.probe()
}

export async function main(
  args: readonly string[],
  print: (line: string) => void,
  probe: SparkProbe = liveSparkProbe(),
): Promise<number> {
  if (args.length > 0) {
    print(usage)
    return exitCodes.usage
  }
  const answer = await probe()
  if (answer.status === 'ready') {
    print('spark: ready')
    return exitCodes.ok
  }
  print(`spark: unavailable (${answer.reason})`)
  return exitCodes.unavailable
}
