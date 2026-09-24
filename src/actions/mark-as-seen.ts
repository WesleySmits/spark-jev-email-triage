import { mailboxCopyId, type MailboxCopyRef } from '../domain/mailbox-copy'
import {
  parseActionApproval,
  parseMailboxActionProposal,
  proposalId,
  type ActionApproval,
  type ActionTarget,
  type MailboxActionProposal,
} from '../domain/mailbox-action'
import { isDurableReceiptStore, type ActionReceiptStore } from './receipt-store'

/** A port for controlled tests. No Spark implementation is connected. */
export interface ExactCopySeenProvider {
  capability(copy: MailboxCopyRef): Promise<Readonly<{
    copy: MailboxCopyRef
    action: 'markAsSeen' | 'unsupported'
    scope: 'exact-mailbox-copy' | 'unproven'
    conditionalVersion: boolean
  }> | null>
  read(copy: MailboxCopyRef): Promise<Readonly<{
    copy: MailboxCopyRef
    threadId: string
    latestMessageId: string
    unread: boolean
  }> | null>
  /** Must compare thread/latest atomically with the mutation. */
  markAsSeen(target: ActionTarget): Promise<void>
}

export type SeenExecutionResult =
  | Readonly<{
      status: 'blocked'
      reason:
        | 'disabled'
        | 'invalid_scope'
        | 'approval'
        | 'preflight'
        | 'receipt_unavailable'
        | 'replay'
        | 'conflict'
    }>
  | Readonly<{ status: 'uncertain' }>
  | Readonly<{ status: 'confirmed' }>

export type SeenExecutionRequest = Readonly<{
  proposal: MailboxActionProposal
  approval: ActionApproval
  idempotencyKey: string
}>

export type SeenExecutionDependencies = Readonly<{
  provider: ExactCopySeenProvider
  receipts: ActionReceiptStore
  /** Must consult a trusted server-owned approval record, not request fields alone. */
  verifyApproval: (proposal: MailboxActionProposal, approval: ActionApproval) => Promise<boolean>
  enabled: () => boolean
  now: () => Date
}>

const approvalLifetimeMs = 5 * 60 * 1000

function approvedNow(
  proposal: MailboxActionProposal,
  approval: ActionApproval,
  now: Date,
): boolean {
  const approvedAt = Date.parse(approval.approvedAt)
  const proposedAt = Date.parse(proposal.proposedAt)
  const age = now.getTime() - approvedAt
  return (
    approval.proposal === proposalId(proposal) &&
    Number.isFinite(age) &&
    approvedAt >= proposedAt &&
    age >= 0 &&
    age <= approvalLifetimeMs
  )
}

function matchesTarget(
  target: ActionTarget,
  observed: Readonly<{
    copy: MailboxCopyRef
    threadId: string
    latestMessageId: string
    unread: boolean
  }> | null,
  unread: boolean,
): boolean {
  return (
    observed !== null &&
    mailboxCopyId(observed.copy) === mailboxCopyId(target.copy) &&
    observed.threadId === target.threadId &&
    observed.latestMessageId === target.latestMessageId &&
    observed.unread === unread
  )
}

function switchOn(enabled: () => boolean): boolean {
  try {
    return enabled()
  } catch {
    return false
  }
}

const supportedAction = (kind: string): boolean => kind === 'markAsSeen'

function parseExecutionRequest(
  value: unknown,
):
  | Readonly<{ status: 'ready'; request: SeenExecutionRequest }>
  | Extract<SeenExecutionResult, { status: 'blocked' }> {
  if (typeof value !== 'object' || value === null) {
    return { status: 'blocked', reason: 'invalid_scope' }
  }
  const fields = value as Record<string, unknown>
  const proposal = parseMailboxActionProposal(fields['proposal'])
  if (proposal === null) return { status: 'blocked', reason: 'invalid_scope' }
  const approval = parseActionApproval(fields['approval'])
  if (approval === null) return { status: 'blocked', reason: 'approval' }
  const idempotencyKey = fields['idempotencyKey']
  if (typeof idempotencyKey !== 'string' || idempotencyKey.trim() === '') {
    return { status: 'blocked', reason: 'conflict' }
  }
  return { status: 'ready', request: { proposal, approval, idempotencyKey } }
}

async function approvalValid(
  proposal: MailboxActionProposal,
  approval: ActionApproval,
  dependencies: SeenExecutionDependencies,
): Promise<boolean> {
  try {
    return (
      approvedNow(proposal, approval, dependencies.now()) &&
      (await dependencies.verifyApproval(proposal, approval))
    )
  } catch {
    return false
  }
}

async function preflight(
  target: ActionTarget,
  provider: ExactCopySeenProvider,
): Promise<'ready' | 'invalid_scope' | 'preflight'> {
  try {
    const capability = await provider.capability(target.copy)
    if (
      capability?.action !== 'markAsSeen' ||
      capability.scope !== 'exact-mailbox-copy' ||
      !capability.conditionalVersion ||
      mailboxCopyId(capability.copy) !== mailboxCopyId(target.copy)
    )
      return 'invalid_scope'
    const before = await provider.read(target.copy)
    return matchesTarget(target, before, true) ? 'ready' : 'preflight'
  } catch {
    return 'preflight'
  }
}

function claimReceipt(
  request: SeenExecutionRequest,
  target: ActionTarget,
  dependencies: SeenExecutionDependencies,
): ReturnType<ActionReceiptStore['claim']> | 'receipt_unavailable' {
  try {
    return dependencies.receipts.claim(
      request.idempotencyKey,
      proposalId(request.proposal),
      target.copy,
      dependencies.now().toISOString(),
    )
  } catch {
    return 'receipt_unavailable'
  }
}

async function attempt(
  request: SeenExecutionRequest,
  target: ActionTarget,
  dependencies: SeenExecutionDependencies,
): Promise<SeenExecutionResult> {
  const { provider, receipts, enabled, now } = dependencies
  const proposal = proposalId(request.proposal)
  // Once claimed, any unresolved receipt remains a terminal guard.
  if (!switchOn(enabled)) return { status: 'uncertain' }
  try {
    await provider.markAsSeen(target)
    const after = await provider.read(target.copy)
    if (after === null || !matchesTarget(target, after, false)) {
      receipts.markUncertain(request.idempotencyKey, proposal)
      return { status: 'uncertain' }
    }
    receipts.confirm(request.idempotencyKey, proposal, now().toISOString(), {
      copy: after.copy,
      threadId: after.threadId,
      latestMessageId: after.latestMessageId,
      unread: false,
    })
    return { status: 'confirmed' }
  } catch {
    // A rejected provider call may have applied. Never infer failure or retry.
    try {
      receipts.markUncertain(request.idempotencyKey, proposal)
    } catch {
      // The pending receipt still prevents replay if finalization failed.
    }
    return { status: 'uncertain' }
  }
}

/**
 * One attempt only. A pending receipt is deliberately terminal for automatic
 * execution, including a crash between the provider call and readback.
 */
export async function runGuardedMarkAsSeen(
  request: SeenExecutionRequest,
  dependencies: SeenExecutionDependencies,
): Promise<SeenExecutionResult> {
  if (!switchOn(dependencies.enabled)) return { status: 'blocked', reason: 'disabled' }
  const parsed = parseExecutionRequest(request)
  if (parsed.status === 'blocked') return parsed
  if (!isDurableReceiptStore(dependencies.receipts)) {
    return { status: 'blocked', reason: 'receipt_unavailable' }
  }
  const validated = parsed.request
  const { proposal, approval } = validated
  if (!supportedAction(proposal.kind)) return { status: 'blocked', reason: 'invalid_scope' }
  const [target] = proposal.targets
  if (proposal.targets.length !== 1 || target === undefined) {
    return { status: 'blocked', reason: 'invalid_scope' }
  }
  if (!(await approvalValid(proposal, approval, dependencies))) {
    return { status: 'blocked', reason: 'approval' }
  }
  const observed = await preflight(target, dependencies.provider)
  if (observed !== 'ready') return { status: 'blocked', reason: observed }
  const claim = claimReceipt(validated, target, dependencies)
  if (claim !== 'claimed') return { status: 'blocked', reason: claim }
  return attempt(validated, target, dependencies)
}
