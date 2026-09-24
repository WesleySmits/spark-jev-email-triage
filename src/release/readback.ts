/**
 * The `pnpm readback:spark` command: does Spark answer on the host this
 * command runs on, right now.
 *
 * It proves nothing about any other host, which is why it says so in its own
 * output. Spark is read through a CLI on the machine holding the mail, so an
 * answer here is only the connectivity of here. A deployed application's
 * connectivity is what that deployment's own runtime answers, and a runtime
 * this command cannot run on has no live result at all rather than this one.
 *
 * It is also deliberately apart from the health endpoint. Health says which
 * commit is deployed and nothing more; this says whether Spark answers and
 * nothing more. A release reports both, separately, because one is never
 * evidence for the other: a healthy build with no Spark reads no mail, and a
 * reachable Spark says nothing about what is deployed.
 *
 * It reads: one mailbox listing, which is `spark accounts`, through the same
 * probe the app uses. The listing is proof that Spark answered and is then
 * dropped, so no address, subject, count or body is ever kept or printed.
 * Failures include fixed recovery guidance, never provider output or configuration values.
 */
import type { SparkReadiness } from '../app/spark-readiness'
import { createSparkReadiness } from '../app/spark-readiness.server'
import { createProcessTransport } from '../spark/process'
import { createSparkMailReader } from '../spark/reader'

export const exitCodes = { ok: 0, unavailable: 1, usage: 64 } as const

const usage = 'usage: pnpm readback:spark'

/**
 * What the answer speaks for. Every line names it, so a result read later
 * cannot be taken for the connectivity of a host it never reached.
 */
const scope = 'spark on this host'

const recovery = {
  missing:
    'Install or enable the Spark Desktop CLI on this Mac and make spark available on PATH in this terminal; then retry.',
  failed:
    'Open Spark Desktop, check that you are signed in, and retry from the same macOS user session. Check CLI permissions if it still fails.',
  malformed:
    'Check that PATH selects the Spark Desktop CLI and that its version is compatible; then retry. Do not share raw account output.',
  'local-only':
    'Run the app and this check on the Mac running Spark, and open the app through 127.0.0.1.',
} satisfies Record<Extract<SparkReadiness, { status: 'unavailable' }>['reason'], string>

async function check(probe: SparkProbe | undefined): Promise<SparkReadiness | null> {
  let ask: SparkProbe
  try {
    ask = probe ?? liveSparkProbe()
  } catch {
    // Reader construction can reject unusable local configuration (e.g. time zone).
    return null
  }
  try {
    return await ask()
  } catch {
    return { status: 'unavailable', reason: 'failed' }
  }
}

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
  probe?: SparkProbe,
): Promise<number> {
  if (args.length > 0) {
    print(usage)
    return exitCodes.usage
  }
  const answer = await check(probe)
  if (answer === null) {
    print(`${scope}: unavailable (configuration)`)
    print(
      'Check the local system time zone and remove an invalid TZ override; restart from the Spark macOS user session and retry.',
    )
    return exitCodes.unavailable
  }
  if (answer.status === 'ready') {
    print(`${scope}: ready`)
    return exitCodes.ok
  }
  print(`${scope}: unavailable (${answer.reason})`)
  print(recovery[answer.reason])
  return exitCodes.unavailable
}
