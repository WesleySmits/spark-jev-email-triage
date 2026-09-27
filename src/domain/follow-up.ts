/**
 * What a person decided about the work one mailbox copy owes, as decisions
 * that are kept rather than held while a message is open.
 *
 * Feature 4 named the step after triage and stored none of it: a decision
 * lived as long as the reader stayed open. This module is the same kind of
 * statement, made durable. A person says a reply is owed, that they will
 * come back to it later, optionally by when, that they finished it in Spark
 * themselves, or that work they had closed is open again. Every one of them
 * is a record in this application and nothing else.
 *
 * Invariants:
 * - Nothing here reaches a provider. `handled_in_spark` records that a
 *   person says they did something in Spark; it asks Spark for nothing,
 *   verifies nothing, and is never evidence that the mail moved. The
 *   guarded Done path stays exactly where it is, with its own approval,
 *   receipt and readback.
 * - A decision names one mailbox copy and the thread version it was decided
 *   against, as a review names the subject it reviewed and a proposal names
 *   its target. It is the same `ActionTarget`, so version staleness is
 *   decided by `targetStanding` here too, rather than by a second rule that
 *   could drift from it.
 * - A decision never travels to a version nobody decided about. Once the
 *   reading moves the thread on, the latest decision is `lapsed`: the work
 *   reads as open again, whatever it said, because a message that arrived
 *   after somebody closed a thread is work they never saw. This is what
 *   keeps an old `handled_in_spark` from quietly making a new message look
 *   dealt with.
 * - A decision never travels to another mailbox copy. Two copies of one
 *   delivery — to an address and to an alias — are two copies under
 *   `mailboxCopyId`, and each carries its own decisions, even though Spark
 *   would act on the provider message id they share.
 * - Deciding again does not edit what was decided before. The latest
 *   decision says where the work stands; the ones before it stay readable as
 *   the history of that copy, which is what makes the record auditable.
 *   Latest is the order the store committed, never the `decidedAt` a caller
 *   supplied: a clock that was corrected between two saves must not reorder
 *   what a person decided, and least of all let a closure outrank the reopen
 *   that answered it.
 * - A due date belongs to work that stays open. `handled_in_spark` and
 *   `reopen` carry none: a date on work nobody owes, or on the act of
 *   reopening it, would be a deadline for nothing.
 * - Nothing here holds a subject, an address or a body: ids, versions,
 *   instants, a local account name and content-free codes only.
 */
import { z } from 'zod'
import {
  actionTargetSchema,
  targetStanding,
  type TargetBreak,
  type TargetObservation,
} from './mailbox-action'
// One instant, written the same way every time, as reviews and proposals are kept.
import { utcInstant } from './review'

/**
 * The decisions a person may record about the work one copy owes:
 * - `reply_needed`: a reply is owed, by them, and has not been written.
 * - `follow_up_later`: nothing is owed now and something is owed later.
 * - `handled_in_spark`: they say they finished it in Spark themselves. This
 *   application asked Spark nothing and read nothing back for it.
 * - `reopen`: work they had closed is owed again.
 *
 * `read_only`, which Feature 4 offers in the reader, is not here. It says no
 * work is owed at all, and this record is of work that is.
 */
export const followUpKinds = [
  'reply_needed',
  'follow_up_later',
  'handled_in_spark',
  'reopen',
] as const

const followUpKindSchema = z.enum(followUpKinds)

export type FollowUpKind = (typeof followUpKinds)[number]

/** Whether a decision leaves work owed on the copy it names. */
const leavesWorkOpen = (kind: FollowUpKind) => kind !== 'handled_in_spark'

/** Whether a decision may carry a date by which the work is owed. */
const takesDueDate = (kind: FollowUpKind) => kind === 'reply_needed' || kind === 'follow_up_later'

const followUpDecisionSchema = z
  .strictObject({
    /** The copy and the thread version decided against. */
    target: actionTargetSchema,
    kind: followUpKindSchema,
    /**
     * When the work is owed, where a person named a date, and `null` where
     * they named none. Accepted in any offset and kept in UTC, so two dates
     * written in different offsets compare as the instants they are.
     */
    dueAt: z.iso.datetime({ offset: true }).transform(utcInstant).nullable(),
    /** Who decided, as this computer names them. Never a mailbox address. */
    decidedBy: z.string().trim().min(1),
    /** Accepted in any offset, kept in UTC, so decisions compare as written. */
    decidedAt: z.iso.datetime({ offset: true }).transform(utcInstant),
  })
  .refine(({ dueAt, kind }) => dueAt === null || takesDueDate(kind), {
    message: 'Only work that stays open carries a due date',
    path: ['dueAt'],
  })

export type FollowUpDecision = Readonly<z.infer<typeof followUpDecisionSchema>>

/** One decision about one exact version. Recording it reaches no provider. */
export const decideFollowUp = (
  decision: z.input<typeof followUpDecisionSchema>,
): FollowUpDecision => followUpDecisionSchema.parse(decision)

/** Parse untrusted decision input before anything is stored or derived from it. */
export const parseFollowUpDecision = (value: unknown): FollowUpDecision | null =>
  followUpDecisionSchema.safeParse(value).data ?? null

/**
 * Where the work on one copy stands:
 * - `undecided`: nobody recorded a decision about this copy.
 * - `open`: the latest decision says work is owed on the version the reading
 *   holds, with the date it named or none.
 * - `handled`: the latest decision says a person finished it in Spark. This
 *   application neither asked Spark nor read anything back, so it is their
 *   claim about that exact version and no proof of where the mail is.
 * - `lapsed`: the latest decision names a version the thread has moved past.
 *   The work is open again and the decision is shown as what it is, out of
 *   date, rather than carried onto a version nobody decided about.
 * - `unobserved`: decisions exist and the reading names no version for this
 *   copy, so which of them describes it now is unknown. Refusing to guess
 *   keeps an old decision from standing for an unread version.
 *
 * Every state carries the decision it read, so what a person said and when
 * stays visible beside where the work stands.
 */
export type FollowUpWork =
  | Readonly<{ state: 'undecided' }>
  | Readonly<{ state: 'open'; decision: FollowUpDecision; dueAt: string | null }>
  | Readonly<{ state: 'handled'; decision: FollowUpDecision }>
  | Readonly<{ state: 'lapsed'; decision: FollowUpDecision; reason: TargetBreak }>
  | Readonly<{ state: 'unobserved'; decision: FollowUpDecision }>

/**
 * Where the work on one copy stands, given every decision recorded for it,
 * **latest first as the store recorded them**, and what the reading observed
 * about that copy.
 *
 * The latest decision decides, because deciding again is how a person
 * replaces what they said; the ones after it in the list are history and are
 * read from the same list wherever that history is shown.
 *
 * Latest means the last one the store committed, not the largest
 * `decidedAt`. A decision carries the instant its caller supplied, and a
 * corrected clock, a machine in another offset or a backdated input can put
 * an earlier instant on a later save. Ordering by that instant would let a
 * `handled_in_spark` saved yesterday outrank the reopen saved after it and
 * hide work a person reopened, so the durable order of the record decides
 * and `decidedAt` is kept as what the caller said, not as the sequence.
 * `readFollowUps` is what establishes that order; nothing here re-sorts.
 *
 * A latest decision whose version the thread has moved past decides nothing
 * about the version that replaced it: the work reads as open again, which is
 * the whole point of binding a decision to a version.
 */
export function followUpWork(
  decisions: readonly FollowUpDecision[],
  observations: readonly TargetObservation[],
): FollowUpWork {
  const [decision] = decisions
  if (decision === undefined) return { state: 'undecided' }
  const standing = targetStanding(decision.target, observations)
  if (standing.status === 'broken') {
    return { state: 'lapsed', decision, reason: standing.reason }
  }
  if (standing.status === 'unobserved') return { state: 'unobserved', decision }
  return leavesWorkOpen(decision.kind)
    ? { state: 'open', decision, dueAt: decision.dueAt }
    : { state: 'handled', decision }
}

/**
 * Why a decision was refused:
 * - `nothing_to_reopen`: a `reopen` was recorded for a copy whose work is
 *   not closed. Reopening what nobody closed would put a decision in the
 *   record that answers none, so it is refused rather than stored.
 * - `request_conflict`: the same request id was used with different content.
 *
 * Both are content-free codes: neither names a subject, an address or a body,
 * so either may be shown or logged as it is.
 */
export type FollowUpRefusal = 'nothing_to_reopen' | 'request_conflict'

export type FollowUpAdmission =
  Readonly<{ status: 'admitted' }> | Readonly<{ status: 'refused'; reason: FollowUpRefusal }>

/**
 * Whether one decision may be recorded, given every decision already stored
 * for the copy it names, latest first as the store recorded them. Pass what
 * the store holds at that moment, inside the transaction that would write,
 * so a decision recorded in between cannot be missed.
 *
 * Only `reopen` is gated, and only on what the record says: it answers a
 * closure, so there has to be one. Which version each decision named makes
 * no difference here, because a `handled_in_spark` the thread has moved past
 * is still the last thing a person said about this copy, and saying it is
 * open again is a statement about the same record.
 *
 * Nothing else is gated. Recording that work is owed needs no permission
 * from the record, and a person may say a reply is owed on a copy they have
 * never decided about, over and over, or after finishing it in Spark.
 */
export function admitFollowUp(
  decision: FollowUpDecision,
  stored: readonly FollowUpDecision[],
): FollowUpAdmission {
  if (decision.kind !== 'reopen') return { status: 'admitted' }
  const [latest] = stored
  return latest?.kind === 'handled_in_spark'
    ? { status: 'admitted' }
    : { status: 'refused', reason: 'nothing_to_reopen' }
}
