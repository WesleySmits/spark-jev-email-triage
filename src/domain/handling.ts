/**
 * What a person decided to do about one message, as four named outcomes, and
 * what each of them changes.
 *
 * A worklist that steers attention still leaves the work undone. This module
 * names the step after it: handle it now, a reply is owed, follow it up
 * later, or reading it was all it asked. Each outcome is a statement about
 * the work a person owes on one mailbox copy. Three of them change nothing
 * but this app's local record of that work. One of them, and only one, also
 * asks Spark to change the mail.
 *
 * Nothing here calls a provider, stores anything or moves mail. Deciding an
 * outcome produces a request: a local work status, and for `handle_now` one
 * Spark Done proposal built by the existing `mailbox-action` model. Making a
 * proposal changes nothing — a person still approves that exact proposal,
 * and the separate guarded executor still holds a durable receipt before
 * Spark is called at all.
 *
 * Invariants:
 * - Every outcome changes the local work status. Exactly one, `handle_now`,
 *   also proposes a mailbox change, because it is the only outcome that says
 *   the message is finished. `reply_needed` and `follow_up_later` say work
 *   remains; `read_only` says none is owed. None of the three is a reason to
 *   take mail out of a person's Inbox behind their back, so none of them
 *   proposes an action. `effectOf` states this per outcome, and a request
 *   carries a proposal exactly where the effect says it does.
 * - The only proposed action is the one already connected: `markAsDone`
 *   with scope `spark-message-id`. No draft, no reply, no snooze, no label
 *   and no second provider write is expressible here. A deferred outcome is
 *   deferred in this app alone: nothing is scheduled with Spark.
 * - Spark Done addresses one exact provider message id and accepts no
 *   mailbox selector. The decided copy's `messageId` is what would be sent.
 *   The mailbox is context for preflight and readback only, so another copy
 *   that carries the same provider id — one delivery to an address and an
 *   alias, for instance — may be affected by an action decided on this row.
 *   The durable receipt store locks unresolved attempts by that id alone, so
 *   one unresolved attempt blocks every copy sharing it. A decision names one
 *   copy and never widens to the copies that share its id.
 * - A decision names the version it was made against — the copy, its thread
 *   and that thread's latest message — as a review names the version it
 *   decided. A later message breaks the proposal it produced, exactly as
 *   `actionStanding` already refuses an approval of a version that moved on.
 * - A judgment may explain a decision and authorizes none. `basis` is
 *   recorded so a person can see what the decision was made from, and it
 *   must name the exact version the decision names: the same mailbox copy,
 *   the same thread and the same latest message. A judgment about another
 *   copy, or about a version that has moved on, is refused rather than
 *   recorded as the reason one row's mail would be archived.
 * - Nothing here holds a subject, an address or a body: ids, versions,
 *   instants and content-free codes only.
 *
 * Not in this model yet: where a work status is kept. This module defines
 * the outcomes and what each one changes; no table, no store and no
 * migration exists for them, and nothing here writes one.
 */
import { z } from 'zod'
import {
  actionTargetSchema,
  proposeMailboxAction,
  type ActionTarget,
  type MailboxActionProposal,
} from './mailbox-action'
import { mailboxCopyId, type MailboxCopyRef } from './mailbox-copy'
// One instant, written the same way every time, as reviews and proposals are kept.
import { utcInstant } from './review'
import { judgedSubjectSchema, type JudgedSubject } from './stored-classification'

/**
 * The four outcomes a person may decide for one message:
 * - `handle_now`: they are dealing with it now and nothing will remain owed.
 * - `reply_needed`: a reply is owed, by them, and has not been written.
 * - `follow_up_later`: nothing is owed now and something is owed later.
 * - `read_only`: reading it was all it asked; no work is owed at all.
 *
 * They are exclusive: one message, one decision about the version shown.
 */
export const handlingOutcomes = [
  'handle_now',
  'reply_needed',
  'follow_up_later',
  'read_only',
] as const

const handlingOutcomeSchema = z.enum(handlingOutcomes)

export type HandlingOutcome = (typeof handlingOutcomes)[number]

/**
 * What choosing one outcome changes:
 * - `work_status`: this app's local record of the work owed on one mailbox
 *   copy, and nothing else. Spark is not called, the mail does not move, and
 *   the person's Inbox is exactly as they left it.
 * - `work_status_and_done_proposal`: that same local record, and in addition
 *   one Spark Done proposal against the decided copy's provider message id.
 *   The proposal is a request, not an action: approval, preflight, a durable
 *   receipt and readback all still stand between it and the mailbox.
 */
export type HandlingEffect = 'work_status' | 'work_status_and_done_proposal'

/**
 * What each outcome changes, stated once.
 *
 * `handle_now` is the only outcome that claims the message is finished, so
 * it is the only one Spark Done could honestly carry out. `read_only` says
 * no work is owed, which is not the same claim: mail nobody must act on is
 * still the person's to file, and archiving it silently would move mail
 * nobody asked to move. Choosing `handle_now` for such a message is how a
 * person asks for that, and it goes through the same approval as any other.
 */
const handlingEffects: Readonly<Record<HandlingOutcome, HandlingEffect>> = {
  handle_now: 'work_status_and_done_proposal',
  reply_needed: 'work_status',
  follow_up_later: 'work_status',
  read_only: 'work_status',
}

/** What one outcome changes. Total over the four outcomes. */
export const effectOf = (outcome: HandlingOutcome): HandlingEffect => handlingEffects[outcome]

/** Whether an outcome asks for a mailbox change at all. */
export const proposesDone = (outcome: HandlingOutcome): boolean =>
  effectOf(outcome) === 'work_status_and_done_proposal'

/**
 * Whether a judgment describes the exact version a decision names. A
 * classification of another mailbox copy, or of a thread version that has
 * been replaced, explains nothing about this row and is never carried as if
 * it did.
 */
const describes = (classification: JudgedSubject, target: ActionTarget) =>
  mailboxCopyId(classification.copy) === mailboxCopyId(target.copy) &&
  classification.threadId === target.threadId &&
  classification.latestMessageId === target.latestMessageId

const handlingDecisionSchema = z
  .strictObject({
    outcome: handlingOutcomeSchema,
    /**
     * The selected row and the thread version it was decided against. The same
     * target the guarded Done path already takes, so a decision that proposes
     * an action needs nothing added to it afterwards.
     */
    target: actionTargetSchema,
    /**
     * The judgment shown when the person decided, where one explains it. It
     * records what the decision was made from and permits nothing.
     */
    basis: z.strictObject({ classification: judgedSubjectSchema }).nullable(),
    /** Accepted in any offset, kept in UTC, so decisions compare as written. */
    decidedAt: z.iso.datetime({ offset: true }).transform(utcInstant),
  })
  .refine(({ basis, target }) => basis === null || describes(basis.classification, target), {
    message: 'A basis names the exact version the decision names',
    path: ['basis'],
  })

export type HandlingDecision = Readonly<z.infer<typeof handlingDecisionSchema>>

/** One decision about one exact version. Deciding changes nothing by itself. */
export const decideHandling = (
  decision: z.input<typeof handlingDecisionSchema>,
): HandlingDecision => handlingDecisionSchema.parse(decision)

/** Parse untrusted decision input before anything is derived from it. */
export const parseHandlingDecision = (value: unknown): HandlingDecision | null =>
  handlingDecisionSchema.safeParse(value).data ?? null

/**
 * The local record one decision makes: the work owed on one mailbox copy, as
 * of the version decided against. It is this app's own status and says
 * nothing about where the mail is; no store for it exists yet.
 */
export type WorkStatusChange = Readonly<{
  copy: MailboxCopyRef
  /** Provider-local: it means nothing outside `copy.mailboxId`. */
  threadId: string
  /** The thread's latest message when the person decided. */
  latestMessageId: string
  outcome: HandlingOutcome
  recordedAt: string
}>

/**
 * What one decision asks for: always a local work status, and a Spark Done
 * proposal only where the outcome's effect says so. `proposal` is null for
 * every other outcome, which is the model's way of saying that choosing them
 * reaches no provider.
 */
export type HandlingRequest = Readonly<{
  outcome: HandlingOutcome
  effect: HandlingEffect
  workStatus: WorkStatusChange
  /** One proposal against the decided copy's provider message id, or none. */
  proposal: MailboxActionProposal | null
}>

const workStatusOf = ({ outcome, target, decidedAt }: HandlingDecision): WorkStatusChange => ({
  copy: target.copy,
  threadId: target.threadId,
  latestMessageId: target.latestMessageId,
  outcome,
  recordedAt: decidedAt,
})

/**
 * What one decision asks for.
 *
 * For `handle_now` this builds one `markAsDone` proposal, scoped as Spark
 * scopes it: one provider message id, no mailbox selector. It names only the
 * copy the person decided about, so copies that share that id are never
 * added as targets — which does not stop Spark from affecting them, and is
 * why approval, preflight and readback remain where they are.
 *
 * Building a request runs nothing. No provider is reached from this module,
 * and the returned proposal is still blocked on approval and on the guarded
 * executor, as `actionStanding` reports for any proposal.
 */
export function handlingRequest(decision: HandlingDecision): HandlingRequest {
  const effect = effectOf(decision.outcome)
  return {
    outcome: decision.outcome,
    effect,
    workStatus: workStatusOf(decision),
    proposal:
      effect === 'work_status_and_done_proposal'
        ? proposeMailboxAction({
            kind: 'markAsDone',
            scope: 'spark-message-id',
            targets: [decision.target],
            basis: decision.basis,
            proposedAt: decision.decidedAt,
          })
        : null,
  }
}
