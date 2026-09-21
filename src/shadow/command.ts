/**
 * The `pnpm shadow` command. Dry by default: it reads Spark and the local
 * database, and reports what a real run would classify. `--apply` sends
 * threads to Jev and stores the outcomes. Output is counts and status codes
 * only, never mail content or credentials.
 */
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { parseArgs } from 'node:util'
import { createJevClassifier } from '../jev/classifier'
import { readJevConfig } from '../jev/config'
import { createSdkTransport } from '../jev/transport'
import { createProcessTransport, defaultLimits } from '../spark/process'
import { createSparkMailReader } from '../spark/reader'
import { shadowConfigSchema, type ShadowConfig } from './config'
import { checkDatabase, openDatabase, openReadOnly, schemaVersion } from './database'
import { runShadowTriage, type ShadowSummary } from './pipeline'

export const exitCodes = { ok: 0, failed: 1, partial: 2, blocked: 3, usage: 64 } as const

const options = {
  mailbox: { type: 'string' },
  apply: { type: 'boolean' },
  limit: { type: 'string' },
  'max-jev-calls': { type: 'string' },
  concurrency: { type: 'string' },
  db: { type: 'string' },
  preflight: { type: 'boolean' },
} as const

const number = (value: string | undefined) => (value === undefined ? undefined : Number(value))

const usage =
  'usage: pnpm shadow --mailbox <address> [--apply] [--limit <n>] [--max-jev-calls <n>] ' +
  '[--concurrency <n>] [--db <path>] | pnpm shadow --preflight'

export async function main(args: string[], env: NodeJS.ProcessEnv, print: (line: string) => void) {
  const values = parseOptions(args)
  if (values === null) {
    print(usage)
    return exitCodes.usage
  }
  if (values.preflight === true) return preflight(print)
  const config = shadowConfigSchema.safeParse({
    mailbox: values.mailbox,
    apply: values.apply,
    limit: number(values.limit),
    maxJevCalls: number(values['max-jev-calls']),
    jevConcurrency: number(values.concurrency),
    databasePath: values.db,
  })
  if (!config.success) {
    // Paths only: values may include the user's own address.
    const fields = config.error.issues.map((issue) => issue.path.join('.'))
    print(`invalid configuration: ${fields.join(', ')}`)
    return exitCodes.usage
  }
  return run(config.data, env, print)
}

async function run(config: ShadowConfig, env: NodeJS.ProcessEnv, print: (line: string) => void) {
  const jev = readJevConfig(env)
  if (config.apply && jev.status === 'missing_credentials') {
    print('blocked: TYPESAFE_API_KEY is not set')
    return exitCodes.blocked
  }
  if (config.apply) mkdirSync(dirname(config.databasePath), { recursive: true })
  const db = config.apply ? openDatabase(config.databasePath) : openReadOnly(config.databasePath)
  try {
    const summary = await runShadowTriage(
      {
        reader: createSparkMailReader({
          transport: createProcessTransport({
            limits: { ...defaultLimits, timeoutMs: config.sparkTimeoutMs },
          }),
          timeZone: config.timeZone,
          log: () => undefined,
        }),
        classify:
          config.apply && jev.status === 'configured'
            ? createJevClassifier(
                createSdkTransport({ apiKey: jev.apiKey, timeoutMs: config.jevTimeoutMs }),
              )
            : null,
        db,
        now: () => new Date().toISOString(),
        processId: process.pid,
        isProcessAlive,
      },
      config,
    )
    formatSummary(summary).forEach(print)
    return exitCode(summary)
  } finally {
    db.close()
  }
}

/** `null` for an unknown option, a missing value, or a stray argument. */
function parseOptions(args: string[]) {
  try {
    return parseArgs({ args, options, strict: true }).values
  } catch (error) {
    if (isParseArgsError(error)) return null
    throw error
  }
}

const isParseArgsError = (error: unknown) =>
  error instanceof TypeError &&
  'code' in error &&
  typeof error.code === 'string' &&
  error.code.startsWith('ERR_PARSE_ARGS_')

/** Signal 0 only checks: `ESRCH` means gone, `EPERM` means alive under another user. */
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ESRCH') return false
    if (error instanceof Error && 'code' in error && error.code === 'EPERM') return true
    throw error
  }
}

export function formatSummary(summary: ShadowSummary): string[] {
  const { mode, status, runId, errorCode, ...counts } = summary
  return [
    `mode: ${mode}`,
    `status: ${status}`,
    ...(runId === null ? [] : [`run: ${String(runId)}`]),
    ...(errorCode === null ? [] : [`error: ${errorCode}`]),
    ...Object.entries(counts).map(([name, value]) => `${name}: ${String(value)}`),
  ]
}

function exitCode(summary: ShadowSummary): number {
  if (summary.status === 'failed') return exitCodes.failed
  if (summary.status === 'partial') return exitCodes.partial
  return exitCodes.ok
}

/**
 * Migrates a disposable database from the empty state and checks it, then
 * deletes it. Touches neither Spark nor the real database.
 */
function preflight(print: (line: string) => void): number {
  const directory = mkdtempSync(join(tmpdir(), 'shadow-preflight-'))
  try {
    const db = openDatabase(join(directory, 'preflight.sqlite'))
    try {
      const problems = checkDatabase(db)
      print(
        problems.length === 0
          ? `preflight ok: schema ${String(schemaVersion)}`
          : `preflight failed: ${problems.join(', ')}`,
      )
      return problems.length === 0 ? exitCodes.ok : exitCodes.failed
    } finally {
      db.close()
    }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}
