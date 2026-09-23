/**
 * Shadow-run configuration. Every bound has a conservative default and a
 * hard ceiling. Text sent to Jev is bounded separately by the fixed limits
 * in `src/jev/state.ts`, which configuration cannot raise.
 */
import { z } from 'zod'
import { mailboxSchema } from '../domain/email'
import { maxListLimit } from '../spark/commands'

const isTimeZone = (zone: string) => Intl.supportedValuesOf('timeZone').includes(zone)

/** Where a run stores its judgments, and where review reads them back. */
const defaultDatabasePath = '.data/shadow-triage.sqlite'

/** Points review at a database a run wrote elsewhere, as `--db` does. */
export const databasePathVariable = 'SHADOW_DATABASE_PATH'

export function readDatabasePath(env: Readonly<Record<string, string | undefined>>): string {
  const path = env[databasePathVariable]?.trim()
  return path === undefined || path === '' ? defaultDatabasePath : path
}

export const shadowConfigSchema = z.strictObject({
  /** The address of the Spark account or shared inbox to read. */
  mailbox: mailboxSchema.shape.address,
  /** Without it, the run only counts what it would classify. */
  apply: z.boolean().default(false),
  /** Recent messages to list; at most one Spark page. */
  limit: z.int().min(1).max(maxListLimit).default(25),
  /** Jev requests per run. Threads beyond it are deferred to a later run. */
  maxJevCalls: z.int().min(1).max(maxListLimit).default(25),
  /** Jev requests in flight at once. Spark calls are always serial. */
  jevConcurrency: z.int().min(1).max(4).default(2),
  jevTimeoutMs: z.int().min(1_000).max(30_000).default(10_000),
  sparkTimeoutMs: z.int().min(1_000).max(60_000).default(15_000),
  databasePath: z.string().trim().min(1).default(defaultDatabasePath),
  /** The zone Spark Desktop prints times in; defaults to this Mac's zone. */
  timeZone: z
    .string()
    .refine(isTimeZone, { message: 'Unknown time zone' })
    .default(() => Intl.DateTimeFormat().resolvedOptions().timeZone),
})

export type ShadowConfig = z.infer<typeof shadowConfigSchema>
