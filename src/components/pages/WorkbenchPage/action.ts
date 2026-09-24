/**
 * How the workbench proposes one mailbox action against one row, and what it
 * says at each of the three stages a person must be able to tell apart.
 *
 * Plain functions of plain data, like `classification.ts` and `review.ts`
 * beside it. Nothing here reads a store, calls a classifier or touches a
 * mailbox, and nothing here executes: it decides which rows a proposal may
 * name at all, turns what the reading says about a row into what the domain
 * calls an observation, and owns the words for proposal, approval and
 * execution.
 *
 * What the copy must never do, and the reason this module owns it:
 *
 * - It never says a mailbox action happened. Execution is blocked at every
 *   stage, because nothing in this build can write to a mailbox, and every
 *   state says the mailbox is unchanged.
 * - It never says an approval permits a provider anything. An approval is a
 *   person's decision, recorded and shown here; no provider is told about it.
 * - It carries no subject, address or body. A stage, a target and a refusal
 *   name mailboxes as the workbench already names them, message and thread
 *   ids, and content-free codes, so the same words may be shown and logged.
 */
import {
  actionStanding,
  preconditionsFor,
  targetStanding,
  type ActionApproval,
  type ActionStanding,
  type ActionTarget,
  type MailboxActionKind,
  type MailboxActionProposal,
  type Precondition,
  type TargetBreak,
  type TargetObservation,
  type TargetStanding,
} from '../../../domain/mailbox-action'
import { mailboxCopyId, type MailboxCopyRef } from '../../../domain/mailbox-copy'
import type { StoredClassification } from '../../../domain/stored-classification'
import type {
  ActionStage,
  ActionTargetView,
  PreconditionView,
} from '../../organisms/ActionProposalPanel/ActionProposalPanel'

/**
 * The one action this workbench may propose. Proposing it asks no provider
 * for anything and permits nothing.
 */
const actionKindLabels = {
  markAsSeen: 'Mark as read',
} as const satisfies Record<MailboxActionKind, string>

/** What a proposal about one row would name: one copy, and what explains it. */
export type Proposable = Readonly<{
  target: ActionTarget
  basis: MailboxActionProposal['basis']
}>

/**
 * What of one row a proposal may name, or nothing at all.
 *
 * A target carries the thread version it is proposed against, so only a row
 * whose stored judgment still names a version can be one: a judgment a
 * reading proved current, or one the store alone holds and contradicts in no
 * way. An outdated judgment, a failed attempt, an untriaged row and a store
 * that could not be read name no version anyone could propose against.
 *
 * The judgment is named as the proposal's basis, which explains it and
 * authorizes nothing: the proposal still waits for a person, and execution
 * stays blocked whatever the classifier said.
 */
export function proposableIn(
  classification: StoredClassification | undefined,
): Proposable | undefined {
  if (classification === undefined) return undefined
  if (classification.state !== 'current' && classification.state !== 'unverified') return undefined
  const { copy, threadId, latestMessageId } = classification.subject
  return {
    target: { copy, threadId, latestMessageId },
    basis: { classification: classification.subject },
  }
}

type StaleReason = Extract<StoredClassification, { state: 'stale' }>['reason']

/**
 * A stale judgment says the thread moved on only where it moved on. Another
 * rubric or another classifier build moved the judgment, not the mail.
 */
const movedBy: Partial<Record<StaleReason, TargetBreak>> = {
  newer_message: 'newer_message',
  other_snapshot: 'other_thread',
}

/**
 * What a reading of one row says about that copy's thread now, in the terms
 * the domain compares a target against, or nothing where it says nothing.
 *
 * Only a judgment a thread read proved current is `proven`: everything else
 * is what a store holds, which can be behind without knowing it. A judgment
 * the store itself contradicts says the thread moved on without naming what
 * replaced it, which is enough to break a proposal and never enough to keep
 * one standing.
 */
export function observationIn(
  classification: StoredClassification | undefined,
): TargetObservation | undefined {
  if (classification === undefined || !('subject' in classification)) return undefined
  const { copy, threadId, latestMessageId } = classification.subject
  const moved = classification.state === 'stale' ? movedBy[classification.reason] : undefined
  if (moved !== undefined) return { copy, observed: 'moved', reason: moved }
  return {
    copy,
    observed: 'named',
    threadId,
    latestMessageId,
    proven: classification.state === 'current',
  }
}

/** One row's proposal as the page holds it, and the approval it has, if any. */
export type HeldProposal = Readonly<{
  proposal: MailboxActionProposal
  approval: ActionApproval | null
}>

/** How a mailbox copy is named here: as the rail names its mailbox. */
export type LabelOf = (copy: MailboxCopyRef) => string

const unchanged = 'Your mailbox is unchanged.'

const breaks = {
  newer_message: 'A later message has reached this thread since.',
  other_thread: 'This copy belongs to another thread than the one proposed against.',
} as const satisfies Record<TargetBreak, string>

const proposalStage = (held: HeldProposal | null, standing: ActionStanding | null): ActionStage => {
  if (held === null || standing === null) {
    return {
      id: 'proposal',
      name: 'Proposal',
      state: { label: 'Nothing proposed', tone: 'neutral' },
      detail: 'Nothing is proposed for this message.',
    }
  }
  const kind = actionKindLabels[held.proposal.kind]
  const copies = held.proposal.targets.length
  return {
    id: 'proposal',
    name: 'Proposal',
    state:
      standing.stage === 'invalidated'
        ? { label: 'Out of date', tone: 'danger' }
        : { label: 'Proposed', tone: 'review' },
    detail:
      standing.stage === 'invalidated'
        ? breaks[standing.reason]
        : `${kind}, against the ${String(copies)} mailbox ${copies === 1 ? 'copy' : 'copies'} named below.`,
  }
}

const approvalStates = {
  none: {
    state: { label: 'Not approved', tone: 'neutral' },
    detail: 'A person approves a proposal as its own step. Nothing approves itself here.',
  },
  waiting: {
    state: { label: 'Waiting for you', tone: 'review' },
    detail: 'Approving records your decision here. No mail provider is asked for anything.',
  },
  lapsed: {
    state: { label: 'No longer holds', tone: 'danger' },
    detail: 'You approved the version this message has moved past, so that approval lapsed.',
  },
  stale: {
    state: { label: 'Not approved', tone: 'neutral' },
    detail: 'This proposal is out of date, so it cannot be approved now.',
  },
} as const

function approvalStage(held: HeldProposal | null, standing: ActionStanding | null): ActionStage {
  const named = { id: 'approval', name: 'Approval' } as const
  if (held === null || standing === null) return { ...named, ...approvalStates.none }
  if (standing.stage === 'invalidated') {
    return { ...named, ...(standing.wasApproved ? approvalStates.lapsed : approvalStates.stale) }
  }
  if (standing.stage === 'proposed') return { ...named, ...approvalStates.waiting }
  return {
    ...named,
    state: { label: 'Approved', tone: 'done' },
    detail: `Approved by ${standing.approval.approvedBy}. That decision is recorded here and nowhere else.`,
  }
}

const executionStage: ActionStage = {
  id: 'execution',
  name: 'Execution',
  state: { label: 'Blocked', tone: 'neutral' },
  detail: `This app has no way to write to a mailbox, so no proposal can be carried out. ${unchanged}`,
}

/** The three stages, in the order they happen, whatever has been proposed. */
export const actionStages = (
  held: HeldProposal | null,
  standing: ActionStanding | null,
): readonly ActionStage[] => [
  proposalStage(held, standing),
  approvalStage(held, standing),
  executionStage,
]

const standings = {
  holds: 'A thread read for this copy still ends there.',
  unproven: 'Only what is stored says so; no thread has been read since.',
  unobserved: 'Nothing read says where this copy stands now.',
  broken: '',
} as const

const wordsFor = (standing: TargetStanding) =>
  standing.status === 'broken' ? breaks[standing.reason] : standings[standing.status]

/**
 * Every mailbox copy the proposal names, each by the mailbox and message ids
 * a provider would be given, with the version it was proposed against and
 * where that copy stands now. Nothing is added to this list: a copy of the
 * same message in another mailbox appears only where the proposal itself
 * named it.
 *
 * The mailbox's name is shown for a reader, and never instead of its id. Two
 * mailboxes may be shown under one name, and one message id may be listed in
 * both, so a name alone would let two different copies read identically.
 */
export function actionTargets(
  held: HeldProposal | null,
  observations: readonly TargetObservation[],
  labelOf: LabelOf,
): readonly ActionTargetView[] {
  if (held === null) return []
  return held.proposal.targets.map((target) => ({
    id: mailboxCopyId(target.copy),
    label: labelOf(target.copy),
    identity: `${target.copy.mailboxId} · message ${target.copy.messageId}`,
    detail: `Proposed against thread ${target.threadId}, latest message ${target.latestMessageId}. ${wordsFor(targetStanding(target, observations))}`,
  }))
}

/** What the panel says one proposal would change, and what is unknown of it. */
export type ActionEffect = Readonly<{ title: string; statement: string; note: string }>

const effectTitle = 'What it would change'

/**
 * What the action would change if it were ever carried out, about the copies
 * it names and about nothing else.
 *
 * It is written so it can never be read as more than it says. It names the
 * copies asked for, and it does not claim what a provider would do with such
 * a request: whether one is enough, whether a provider touches the rest of a
 * thread, and how it scopes a message id are all unverified here. Nothing
 * has run, and nothing can, so this is a description of a request nobody has
 * made rather than a report of anything that happened.
 */
export function actionEffect(held: HeldProposal | null, labelOf: LabelOf): ActionEffect {
  if (held === null) {
    return {
      title: effectTitle,
      statement: 'Nothing is proposed, so nothing would change.',
      note: unchanged,
    }
  }
  const named = held.proposal.targets
    .map(
      (target) =>
        `${labelOf(target.copy)} (${target.copy.mailboxId} · message ${target.copy.messageId})`,
    )
    .join(', ')
  const copies = held.proposal.targets.length
  return {
    title: effectTitle,
    statement: `The intended effect is to mark ${copies === 1 ? 'only the copy' : 'only the copies'} named above as read: ${named}.`,
    note: `Spark has not verified that this action can target these exact mailbox copies without changing others. Its effect on the rest of the thread is also unverified. No live write is connected, and ${unchanged.toLowerCase()}`,
  }
}

const met = { label: 'Met', tone: 'done' } as const
const unmet = { label: 'Not met', tone: 'neutral' } as const

function preconditionView(
  precondition: Precondition,
  standing: ActionStanding | null,
  observations: readonly TargetObservation[],
  labelOf: LabelOf,
): PreconditionView {
  if (precondition.name === 'human_approval') {
    return {
      id: 'human_approval',
      label: 'A person approved this exact proposal',
      state: standing?.stage === 'approved' ? met : unmet,
    }
  }
  if (precondition.name === 'write_adapter_connected') {
    return {
      id: 'write_adapter_connected',
      label: 'Something could carry the action out',
      state: { label: 'Not connected', tone: 'neutral' },
    }
  }
  const holds = targetStanding(precondition, observations).status === 'holds'
  const { copy } = precondition
  return {
    id: `thread_unchanged:${mailboxCopyId(copy)}`,
    // The mailbox id, not only its name: one precondition per target, and two
    // targets may be shown under one name.
    label: `The thread of ${labelOf(copy)} (${copy.mailboxId}) still ends at message ${precondition.latestMessageId}`,
    state: holds ? met : unmet,
  }
}

/** The preconditions that apply now, each named and each said to be met or not. */
export function actionPreconditions(
  held: HeldProposal | null,
  standing: ActionStanding | null,
  observations: readonly TargetObservation[],
  labelOf: LabelOf,
): readonly PreconditionView[] {
  const preconditions: readonly Precondition[] =
    held === null
      ? [{ name: 'human_approval' }, { name: 'write_adapter_connected' }]
      : preconditionsFor(held.proposal)
  return preconditions.map((precondition) =>
    preconditionView(precondition, standing, observations, labelOf),
  )
}

/**
 * Why approving was refused, in words. Each says what a person can do next
 * and names no message.
 */
const refusals = {
  stale_target: `This proposal names a version this message has moved past, so it was not approved. Propose again against what holds now. ${unchanged}`,
  other_proposal: `The approval named another proposal, so nothing was approved. ${unchanged}`,
} as const

/** What the page holds about one row, beyond the proposal itself. */
export type ActionResult = Readonly<{ title: string; detail: string }>

/**
 * The result copy beside the buttons. `refusal` is what the last approval
 * attempt was refused for, where one was; it is about that attempt alone and
 * never about what is shown above it.
 */
export function actionResult(
  standing: ActionStanding | null,
  refusal: keyof typeof refusals | null,
): ActionResult {
  if (refusal !== null) return { title: 'Not approved', detail: refusals[refusal] }
  if (standing === null) {
    return {
      title: 'Nothing proposed',
      detail: `Proposing names this one mailbox copy and no other. ${unchanged}`,
    }
  }
  if (standing.stage === 'invalidated') {
    return { title: 'Out of date', detail: `${breaks[standing.reason]} ${unchanged}` }
  }
  if (standing.stage === 'proposed') {
    return {
      title: 'Not approved',
      detail: `Approving records your decision here. ${unchanged}`,
    }
  }
  return {
    title: 'Approved, not carried out',
    detail: `Nothing was sent to your mail provider, and nothing can be. ${unchanged}`,
  }
}

/** What a withdrawal leaves behind: nothing proposed, and nothing done. */
export const withdrawnAnnouncement = `Proposal withdrawn. Nothing was proposed, approved or carried out. ${unchanged}`

/**
 * What a polite live region announces once something happens here. It says
 * what was decided and that the mailbox is unchanged, so nobody hears a
 * mailbox action in it.
 */
export const actionAnnouncement = (result: ActionResult) => `${result.title}. ${result.detail}`

/** Where one row's proposal stands now, or nothing while none is held. */
export const standingOf = (
  held: HeldProposal | null,
  observations: readonly TargetObservation[],
): ActionStanding | null =>
  held === null ? null : actionStanding(held.proposal, held.approval, observations)
