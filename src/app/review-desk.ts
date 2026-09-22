/**
 * The review desk: the root route's one interface for reading live mail
 * deeply. The server boundary, Spark and the mail reader stay behind this
 * module, so the route itself imports no server, provider or classifier code.
 *
 * Strictly read-only, and nothing here starts a read on its own:
 * - `open` reads the desk once, for the route's loader.
 * - `focus` reads one opened row's body, lazily, over what an `open` listed.
 * - `probe` only asks whether Spark answers; it learns nothing about mail.
 *
 * No mailbox is changed, and no classifier is called.
 */
import type { BodyLoader } from './inbox'
import { liveBodyLoader, liveWorkflows, type LiveInbox } from './live-inbox'
import { getLiveBody, getLiveInbox } from './live-inbox.functions'
import type { ConnectionReason } from './reconnect'
import type { SparkReadiness } from './spark-readiness'
import { getSparkReadiness } from './spark-readiness.functions'

/** Why the desk waits: a reason the server gave, or an app server that didn't answer. */
export type DeskReason = ConnectionReason

/**
 * What one `open` found: the readable mailboxes and their recent rows,
 * without bodies, or why there are none. Plain data, so the route may hand
 * it to the browser, and `unavailable` never comes with messages.
 */
export type DeskView = LiveInbox | Readonly<{ status: 'unavailable'; reason: 'unreachable' }>

/** No rows to focus in: an unavailable desk lists nothing, sample or otherwise. */
const rowsOf = (view: DeskView) => (view.status === 'ready' ? view.messages : [])

export const ReviewDesk = {
  /** The rail's workflows. Live mail isn't triaged yet, so there is one. */
  workflows: liveWorkflows,

  /**
   * Reads the desk once: the mailboxes this computer may read and a few
   * recent messages in each, newest first and without bodies. It never
   * rejects, so the page always has something to show: an app server that
   * didn't answer is `unreachable`, like any other absence. Opening again
   * reads again, which is all Refresh does.
   */
  open: (): Promise<DeskView> =>
    getLiveInbox().catch(() => ({ status: 'unavailable', reason: 'unreachable' }) as const),

  /**
   * Reads the body of one row of `view`, lazily: only when that row opens,
   * and only ever one. Each row is read through the mailbox its own summary
   * names, so one message id listed in two mailboxes stays two rows. A row
   * this reading didn't list resolves to `null` without asking; the server
   * decides again anyway, and only offers what it last listed. A provider
   * failure rejects, so the reader can offer a retry.
   */
  focus: (view: DeskView): BodyLoader =>
    liveBodyLoader(rowsOf(view), (data, signal) => getLiveBody({ data, signal })),

  /**
   * Whether Spark answers now, while the page waits for it. The answer holds
   * no mailbox, address, count or message.
   */
  probe: (signal: AbortSignal): Promise<SparkReadiness> => getSparkReadiness({ signal }),
} as const
