/**
 * Shadow-run configuration. Every bound has a conservative default and a
 * hard ceiling. Text sent to Jev is bounded separately by the fixed limits
 * in `src/jev/state.ts`, which configuration cannot raise.
 */
import { z } from 'zod'
import { mailboxSchema } from '../domain/email'
import { maxListLimit } from '../spark/commands'

const isTimeZone = (zone: string) => Intl.supportedValuesOf('timeZone').includes(zone)

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
  databasePath: z.string().trim().min(1).default('.data/shadow-triage.sqlite'),
  /** The zone Spark Desktop prints times in; defaults to this Mac's zone. */
  timeZone: z
    .string()
    .refine(isTimeZone, { message: 'Unknown time zone' })
    .default(() => Intl.DateTimeFormat().resolvedOptions().timeZone),
})

export type ShadowConfig = z.infer<typeof shadowConfigSchema>
