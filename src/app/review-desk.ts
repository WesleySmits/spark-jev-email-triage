/**
 * The review desk: the root route's one interface for reading live mail
 * deeply, for recording a human review, and for the separately guarded Done
 * action. Server boundaries and Spark stay behind this module, so the route
 * imports no provider or server-only code.
 *
 * Nothing here starts a read on its own:
 * - `open` reads the desk once, for the route's loader.
 * - `focus` reads one opened row's body, lazily, over what an `open` listed,
 *   and with it what that read proves about the row's stored judgment.
 * - `probe` only asks whether Spark answers; it learns nothing about mail.
 * - `review` records one person's reading of one stored classification.
 * - `approveDone` and `executeDone` call the local-only action server.
 *
 * Reviewing never completes a message. Only the explicit Done path can ask
 * Spark to change one, and its server owns approval, receipts and readback.
 */
import type { DeskReviewOutcome, DeskReviewReadback, DeskReviewRequest } from './desk-review'
import type { BodyLoader } from './inbox'
import {
  liveBodyLoader,
  liveWorkflows,
  type ClassifiedInbox,
  type InboxListRequest,
} from './live-inbox'
import { getLiveBody, getLiveInbox } from './live-inbox.functions'
import type { ConnectionReason } from './reconnect'
import { checkReview, saveReview } from './review.functions'
import type { SparkReadiness } from './spark-readiness'
import { getSparkReadiness } from './spark-readiness.functions'
import { approveDoneAction, executeDoneAction } from './done-action.functions'
import type { DoneApprovalResult, DoneExecutionRequest, DoneExecutionResult } from './done-action'
import type { MailboxActionProposal } from '../domain/mailbox-action'
import type {
  TriageRunReadResult,
  TriageRunRestart,
  TriageRunStart,
  TriageRunStartResult,
  TriageRunStopResult,
} from './triage-run'
import {
  readTriageRun,
  restartTriageRun,
  startTriageRun,
  stopTriageRun,
} from './triage-run.functions'

/** Why the desk waits: a reason the server gave, or an app server that didn't answer. */
export type DeskReason = ConnectionReason

/**
 * What one `open` found: the readable mailboxes, their recent rows without
 * bodies, and what is stored about each row, or why there are none. Plain
 * data, so the route may hand it to the browser, and `unavailable` never
 * comes with messages.
 */
export type DeskView = ClassifiedInbox | Readonly<{ status: 'unavailable'; reason: 'unreachable' }>

/** No rows to focus in: an unavailable desk lists nothing, sample or otherwise. */
const rowsOf = (view: DeskView) => (view.status === 'ready' ? view.messages : [])

export const ReviewDesk = {
  /** The rail's workflows. Live mail isn't triaged yet, so there is one. */
  workflows: liveWorkflows,

  /**
   * Reads the desk once: the mailboxes this computer may read, a few recent
   * messages in each, newest first and without bodies, and the judgment
   * shadow triage last stored about each of those rows. Reading judges
   * nothing: no classifier is called, here or on opening again, which is all
   * Refresh does. No thread is read either, so a stored judgment is at most
   * `unverified` here; only focusing a row can prove it current. It never
   * rejects, so the page always has something to show: an app server that
   * didn't answer is `unreachable`, like any other absence, a row with no
   * stored judgment is unclassified, and judgments that cannot be read are
   * reported as unavailable rather than as absent.
   */
  open: (request: InboxListRequest = { view: 'unread' }): Promise<DeskView> =>
    getLiveInbox({ data: request }).catch(
      () => ({ status: 'unavailable', reason: 'unreachable' }) as const,
    ),

  /**
   * Reads the body of one row of `view`, lazily: only when that row opens,
   * and only ever one. Each row is read through the mailbox its own summary
   * names, so one message id listed in two mailboxes stays two rows. A row
   * this reading didn't list resolves to `null` without asking; the server
   * decides again anyway, and only offers what it last listed. A provider
   * failure rejects, so the reader can offer a retry.
   *
   * The thread this read returns is the only evidence that can make a stored
   * judgment `current`, so the body carries what it proved about the row.
   * That costs no extra provider call, and a judgment that cannot be read
   * never holds up the body.
   */
  focus: (view: DeskView): BodyLoader =>
    liveBodyLoader(rowsOf(view), (data, signal) => getLiveBody({ data, signal })),

  /**
   * Whether Spark answers now, while the page waits for it. The answer holds
   * no mailbox, address, count or message.
   */
  probe: (signal: AbortSignal): Promise<SparkReadiness> => getSparkReadiness({ signal }),

  /**
   * Records one person's confirmation or correction of one stored
   * classification, naming the exact version they were shown: the mailbox
   * copy, its thread, that thread's latest message then, the rubric and the
   * pinned classifier build. A review of a version the store has moved past
   * is refused rather than applied to the one that replaced it.
   *
   * It decides labels and nothing else. No mailbox is read or changed, no
   * Spark command runs and no classifier is asked, so a saved review is
   * never a completed message. It never rejects: when the transport drops
   * the answer, the outcome is unknown because the server may have committed.
   */
  review: (request: DeskReviewRequest): Promise<DeskReviewOutcome> =>
    saveReview({ data: request }).catch(() => ({ status: 'unknown' }) as const),

  /** Reads the local store only; a failed check remains unavailable. */
  check: (request: DeskReviewRequest): Promise<DeskReviewReadback> =>
    checkReview({ data: request }).catch(() => ({ status: 'unavailable' }) as const),

  approveDone: (proposal: MailboxActionProposal): Promise<DoneApprovalResult> =>
    approveDoneAction({ data: { proposal } }).catch(
      () => ({ status: 'blocked', reason: 'journal_unavailable' }) as const,
    ),

  executeDone: (request: DoneExecutionRequest): Promise<DoneExecutionResult> =>
    executeDoneAction({ data: request }).catch(() => ({ status: 'uncertain' }) as const),

  /** Explicit Start is the only desk operation that may invoke Jev. */
  startTriage: (request: TriageRunStart): Promise<TriageRunStartResult> =>
    startTriageRun({ data: request }).catch(
      () => ({ status: 'blocked', reason: 'store_unavailable' }) as const,
    ),

  /** A new run over the older run's durable selection; still an explicit action. */
  restartTriage: (request: TriageRunRestart): Promise<TriageRunStartResult> =>
    restartTriageRun({ data: request }).catch(
      () => ({ status: 'blocked', reason: 'store_unavailable' }) as const,
    ),

  /** Local durable readback only; it never reads mail or invokes Jev. */
  triageStatus: (runId: string): Promise<TriageRunReadResult> =>
    readTriageRun({ data: { runId } }).catch(() => ({ status: 'unavailable' }) as const),

  /** Requests a cooperative stop and performs no mailbox mutation. */
  stopTriage: (runId: string): Promise<TriageRunStopResult> =>
    stopTriageRun({ data: { runId } }).catch(() => ({ status: 'unavailable' }) as const),
} as const
