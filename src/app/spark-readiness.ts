/**
 * Whether Spark answers, as the browser sees it while it waits for mail.
 * Browser-safe: this module imports no server code. The probe itself is
 * `spark-readiness.server.ts`, reached only through
 * `spark-readiness.functions.ts`.
 */
import type { LiveInbox } from './live-inbox'

/** Why the live inbox can't be read, as the server reports it. */
export type UnavailableReason = Extract<LiveInbox, { status: 'unavailable' }>['reason']

/**
 * One readiness answer. It says nothing about mail: no mailbox, address,
 * count or message, only whether Spark answered and, if not, why.
 */
export type SparkReadiness =
  Readonly<{ status: 'ready' }> | Readonly<{ status: 'unavailable'; reason: UnavailableReason }>
