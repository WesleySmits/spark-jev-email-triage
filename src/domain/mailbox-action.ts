/**
 * One proposed mailbox action: what would be done, to which mailbox copies,
 * what must hold before anyone could do it, and how far it has got. Nothing
 * here does it. No provider is reached from this module, and no adapter that
 * could write to a mailbox exists in this build at all.
 *
 * A proposal, a person's approval of it and an execution are three separate
 * things, and this module keeps them separate:
 *
 * - A proposal says what would be asked of a provider, against copies it
 *   names. Making one changes nothing and permits nothing.
 * - An approval is a person's decision about one exact proposal. It is
 *   modelled and shown here; it is not a provider's permission, and no
 *   provider is told about it. An approval of a proposal whose targets have
 *   moved on is refused, and one that had been given stops holding.
 * - Execution has no ready form here. `ExecutionStanding` is always
 *   `blocked`, because no live Spark write adapter is connected. The separate
 *   guarded executor can exercise a fake provider in tests; this domain
 *   standing never reports a live mailbox action as carried out.
 *
 * Invariants:
 * - A target is one mailbox copy, identified by mailbox and provider message
 *   id, and every target is named in the proposal. Nothing here derives,
 *   expands or adds one. Two copies of one delivery, e.g. to two aliases,
 *   are two targets and must both be named to be acted on; naming one never
 *   reaches the other, whatever a person believes about them. See
 *   `mailboxCopyId`.
 * - Each target also names the thread version it was proposed against. A
 *   later message in that thread, or another thread for that copy, breaks
 *   the proposal, and with it any approval already given: `actionStanding`
 *   answers `invalidated` rather than letting an approval of the version
 *   before stand for the one that replaced it.
 * - A classification or a review may explain why a proposal was made, and
 *   `basis` records that. It authorizes nothing: a proposal whose basis is a
 *   current classification still waits for a person, and a person's approval
 *   still leaves execution blocked.
 * - Nothing here holds a subject, an address or a body. A proposal, an
 *   approval, a standing and a refusal name ids, versions and content-free
 *   codes only, so any of them may be shown or logged as it is.
 */
import { z } from 'zod'
import { mailboxCopyId, mailboxCopyRefSchema, type MailboxCopyRef } from './mailbox-copy'
// One instant, written the same way every time, as reviews are kept.
import { utcInstant } from './review'
import { judgedSubjectSchema } from './stored-classification'

const id = z.string().trim().min(1)

/**
 * The only action currently proposed. The separately guarded executor can
 * mark one exact copy as seen through a scoped provider port; no live Spark
 * write adapter is connected.
 */
const mailboxActionKindSchema = z.enum(['markAsSeen'])

export type MailboxActionKind = z.infer<typeof mailboxActionKindSchema>

/**
 * One target: the mailbox copy the action would be applied to, and the
 * thread version it was proposed against. The version is the precondition
 * the target carries, so a proposal can be found stale without anything
 * being read again.
 */
const actionTargetSchema = z.strictObject({
  /** The exact copy. A copy in another mailbox is another target. */
  copy: mailboxCopyRefSchema,
  /** Provider-local: it means nothing outside `copy.mailboxId`. */
  threadId: id,
  /** The thread's latest message when the action was proposed. */
  latestMessageId: id,
})

export type ActionTarget = Readonly<z.infer<typeof actionTargetSchema>>

/** The version of one target, as one comparable value. */
const targetId = ({ copy, threadId, latestMessageId }: ActionTarget) =>
  JSON.stringify([mailboxCopyId(copy), threadId, latestMessageId])

const targetsSchema = z
  .array(actionTargetSchema)
  .min(1)
  .refine(
    (targets) => new Set(targets.map(({ copy }) => mailboxCopyId(copy))).size === targets.length,
    { message: 'A proposal names each mailbox copy once' },
  )

const mailboxActionProposalSchema = z.strictObject({
  kind: mailboxActionKindSchema,
  /**
   * Every mailbox copy the action would touch, named. This list is the whole
   * scope of the proposal: nothing is added to it later and nothing is
   * inferred from it.
   */
  targets: targetsSchema,
  /**
   * Why it was proposed, where anything explains it. A classification
   * explains a proposal and authorizes none: it is recorded so a person can
   * see what the proposal was made from, and it is never read as permission.
   */
  basis: z.strictObject({ classification: judgedSubjectSchema }).nullable(),
  /** Accepted in any offset, kept in UTC, so proposals compare as written. */
  proposedAt: z.iso.datetime({ offset: true }).transform(utcInstant),
})

export type MailboxActionProposal = Readonly<z.infer<typeof mailboxActionProposalSchema>>

/**
 * One proposal against exactly the copies given. Every target is named by
 * the caller: nothing is added here, so a second copy of the same message in
 * another mailbox is a target only where the caller named it.
 */
export const proposeMailboxAction = (
  proposal: z.input<typeof mailboxActionProposalSchema>,
): MailboxActionProposal => mailboxActionProposalSchema.parse(proposal)

/** Parse untrusted execution input without passing malformed data to a provider. */
export const parseMailboxActionProposal = (value: unknown): MailboxActionProposal | null =>
  mailboxActionProposalSchema.safeParse(value).data ?? null

const basisId = (basis: MailboxActionProposal['basis']) => {
  if (basis === null) return null
  const { copy, threadId, latestMessageId, rubric, classifierVersion } = basis.classification
  return [mailboxCopyId(copy), threadId, latestMessageId, rubric, classifierVersion]
}

/**
 * The exact proposal, including its classification basis and creation time.
 * An approval never travels to another version or another basis.
 */
export const proposalId = (proposal: MailboxActionProposal) =>
  JSON.stringify([
    proposal.kind,
    proposal.targets.map(targetId).sort(),
    basisId(proposal.basis),
    proposal.proposedAt,
  ])

/**
 * What must hold before this action could be carried out, each one named:
 * - `thread_unchanged`: one target's thread still ends at the message the
 *   proposal named. There is one of these per target.
 * - `human_approval`: a person approved this exact proposal.
 * - `write_adapter_connected`: something could carry the action out at all.
 *   Nothing in this build can, so this one is never met.
 */
export type Precondition =
  | Readonly<{ name: 'thread_unchanged' } & ActionTarget>
  | Readonly<{ name: 'human_approval' }>
  | Readonly<{ name: 'write_adapter_connected' }>

const threadUnchanged = (target: ActionTarget): Precondition => ({
  name: 'thread_unchanged',
  ...target,
})

/** Every precondition of one proposal, in order, with none left implicit. */
export const preconditionsFor = (proposal: MailboxActionProposal): readonly Precondition[] => [
  ...proposal.targets.map(threadUnchanged),
  { name: 'human_approval' },
  { name: 'write_adapter_connected' },
]

/** How a target's thread moved away from the version proposed against. */
export type TargetBreak = 'newer_message' | 'other_thread'

/**
 * What one reading says about a target copy's thread now:
 * - `named`: it names the thread and its latest message. `proven` says
 *   whether a thread the provider just returned says so, or a store alone,
 *   which can be behind without knowing it.
 * - `moved`: it says the thread has moved past the version named without
 *   naming what replaced it, as a store that observed a newer message does.
 *
 * An observation for another copy says nothing about this one.
 */
export type TargetObservation = Readonly<{ copy: MailboxCopyRef }> &
  (
    | Readonly<{ observed: 'named'; threadId: string; latestMessageId: string; proven: boolean }>
    | Readonly<{ observed: 'moved'; reason: TargetBreak }>
  )

/**
 * Where one target stands:
 * - `unobserved`: nothing read says anything about that copy.
 * - `unproven`: what a store holds matches, which is not evidence of what
 *   the provider holds now.
 * - `holds`: a thread the provider returned names the version proposed against.
 * - `broken`: the thread has moved on, so the proposal no longer describes it.
 */
export type TargetStanding =
  | Readonly<{ status: 'unobserved' }>
  | Readonly<{ status: 'unproven' }>
  | Readonly<{ status: 'holds' }>
  | Readonly<{ status: 'broken'; reason: TargetBreak }>

const unobserved: TargetStanding = { status: 'unobserved' }

/** Where one target stands, given what has been observed about its copy. */
export function targetStanding(
  target: ActionTarget,
  observations: readonly TargetObservation[],
): TargetStanding {
  const seen = observations.find(({ copy }) => mailboxCopyId(copy) === mailboxCopyId(target.copy))
  if (seen === undefined) return unobserved
  if (seen.observed === 'moved') return { status: 'broken', reason: seen.reason }
  if (seen.latestMessageId !== target.latestMessageId) {
    return { status: 'broken', reason: 'newer_message' }
  }
  if (seen.threadId !== target.threadId) return { status: 'broken', reason: 'other_thread' }
  return seen.proven ? { status: 'holds' } : { status: 'unproven' }
}

/** Weakest first, so the weakest target decides where a whole proposal stands. */
const strength = { broken: 0, unobserved: 1, unproven: 2, holds: 3 } as const

/**
 * Where every target stands together. One broken target breaks the proposal:
 * an action against copies it no longer describes is not a smaller action,
 * it is a different one.
 */
export function proposalStanding(
  proposal: MailboxActionProposal,
  observations: readonly TargetObservation[],
): TargetStanding {
  const standings = proposal.targets.map((target) => targetStanding(target, observations))
  const [first] = standings
  if (first === undefined) return unobserved
  return standings.reduce(
    (weakest, standing) =>
      strength[standing.status] < strength[weakest.status] ? standing : weakest,
    first,
  )
}

const actionApprovalSchema = z.strictObject({
  /** The exact proposal approved, as `proposalId` names it. */
  proposal: id,
  /** Who approved, as this computer names them. Never a mailbox address. */
  approvedBy: z.string().trim().min(1),
  /** Accepted in any offset, kept in UTC, so approvals compare as written. */
  approvedAt: z.iso.datetime({ offset: true }).transform(utcInstant),
})

export type ActionApproval = Readonly<z.infer<typeof actionApprovalSchema>>

/** Parse untrusted approval data before checking its exact proposal identity. */
export const parseActionApproval = (value: unknown): ActionApproval | null =>
  actionApprovalSchema.safeParse(value).data ?? null

/**
 * One person's approval of one exact proposal. It is a decision about this
 * proposal and nothing else: it permits no provider anything by itself.
 * The live workbench has no Spark write adapter.
 */
export const approveProposal = (
  proposal: MailboxActionProposal,
  by: Readonly<{ approvedBy: string; approvedAt: string }>,
): ActionApproval => actionApprovalSchema.parse({ proposal: proposalId(proposal), ...by })

/**
 * Execution, which is always blocked. There is no ready form of this type,
 * because no write adapter is connected in this build: `unmet` always holds
 * `write_adapter_connected`, whatever else holds. Nothing may read this as
 * an action that was carried out.
 */
export type ExecutionStanding = Readonly<{
  status: 'blocked'
  /** Every precondition that is not met, named. Never empty. */
  unmet: readonly Precondition[]
}>

/**
 * How far one proposal has got, and where execution stands with it.
 *
 * `invalidated` wins over everything: a target that has moved on ends the
 * proposal whether or not a person had approved it, and `wasApproved` says
 * which of the two happened so nobody is told an approval they gave was
 * never there. An approval naming another proposal decides nothing here; the
 * proposal reads as still waiting for one.
 */
export type ActionStanding = Readonly<{
  /** Where the targets stand together. */
  targets: TargetStanding
  /** Always blocked, at every stage. */
  execution: ExecutionStanding
}> &
  (
    | Readonly<{ stage: 'proposed' }>
    | Readonly<{ stage: 'approved'; approval: ActionApproval }>
    | Readonly<{ stage: 'invalidated'; reason: TargetBreak; wasApproved: boolean }>
  )

/** Every precondition still unmet, with the adapter one always among them. */
function unmetIn(
  proposal: MailboxActionProposal,
  observations: readonly TargetObservation[],
  approved: boolean,
): readonly Precondition[] {
  const targets = proposal.targets
    .filter((target) => targetStanding(target, observations).status !== 'holds')
    .map(threadUnchanged)
  const approval: readonly Precondition[] = approved ? [] : [{ name: 'human_approval' }]
  // No Spark write adapter is connected, so this one cannot be met at all.
  return [...targets, ...approval, { name: 'write_adapter_connected' }]
}

/**
 * Where one proposal stands, given the approval it has, if any, and what has
 * been observed about its targets since.
 */
export function actionStanding(
  proposal: MailboxActionProposal,
  approval: ActionApproval | null,
  observations: readonly TargetObservation[],
): ActionStanding {
  const targets = proposalStanding(proposal, observations)
  const approved = approval !== null && approval.proposal === proposalId(proposal) ? approval : null
  const execution: ExecutionStanding = {
    status: 'blocked',
    unmet: unmetIn(proposal, observations, approved !== null && targets.status !== 'broken'),
  }
  if (targets.status === 'broken') {
    return {
      stage: 'invalidated',
      reason: targets.reason,
      wasApproved: approved !== null,
      targets,
      execution,
    }
  }
  return approved === null
    ? { stage: 'proposed', targets, execution }
    : { stage: 'approved', approval: approved, targets, execution }
}

/**
 * Why an approval was refused:
 * - `stale_target`: a target's thread has moved past the version proposed
 *   against, so the approval would be of a proposal that no longer describes
 *   the mail. Propose again against what holds now.
 * - `other_proposal`: the approval names another proposal, or another
 *   version of this one. One proposal's approval never travels to another.
 *
 * Both are content-free codes: neither names a subject, an address or a body.
 */
export type ApprovalRefusal = 'stale_target' | 'other_proposal'

export type ApprovalAdmission =
  Readonly<{ status: 'admitted' }> | Readonly<{ status: 'refused'; reason: ApprovalRefusal }>

/**
 * Whether one approval may stand for one proposal, given what has been
 * observed about its targets. This is the only gate on approving, and it
 * admits an approval of what the proposal names and nothing else.
 *
 * Admitting an approval is not permission to act: execution stays blocked on
 * `write_adapter_connected` either way.
 */
export function admitApproval(
  proposal: MailboxActionProposal,
  approval: ActionApproval,
  observations: readonly TargetObservation[],
): ApprovalAdmission {
  const { stage } = actionStanding(proposal, approval, observations)
  if (stage === 'invalidated') return { status: 'refused', reason: 'stale_target' }
  if (stage === 'proposed') return { status: 'refused', reason: 'other_proposal' }
  return { status: 'admitted' }
}
