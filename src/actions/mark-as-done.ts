import {
  parseActionApproval,
  parseMailboxActionProposal,
  proposalId,
  type ActionApproval,
  type ActionTarget,
  type MailboxActionProposal,
} from '../domain/mailbox-action'
import { isDurableReceiptStore, type ActionReceiptStore } from './receipt-store'
import type { SparkDoneProviderPort } from '../spark/done-provider'
export type { SparkDoneProviderPort } from '../spark/done-provider'

type DoneExecutionResult =
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

type DoneExecutionRequest = Readonly<{
  proposal: MailboxActionProposal
  approval: ActionApproval
  idempotencyKey: string
}>

export type DoneExecutionDependencies = Readonly<{
  provider: SparkDoneProviderPort
  receipts: ActionReceiptStore
  /** Consult a server-owned durable approval record, not request fields alone. */
  verifyApproval: (proposal: MailboxActionProposal, approval: ActionApproval) => Promise<boolean>
  enabled: () => boolean
  now: () => Date
}>

const approvalLifetimeMs = 5 * 60 * 1000
const sparkMessageId = /^[1-9][0-9]{0,18}$/

function switchOn(enabled: () => boolean): boolean {
  try {
    return enabled()
  } catch {
    return false
  }
}

function parseExecutionRequest(
  value: unknown,
):
  | Readonly<{ status: 'ready'; request: DoneExecutionRequest }>
  | Extract<DoneExecutionResult, { status: 'blocked' }> {
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
  dependencies: DoneExecutionDependencies,
): Promise<boolean> {
  const approvedAt = Date.parse(approval.approvedAt)
  const proposedAt = Date.parse(proposal.proposedAt)
  const age = dependencies.now().getTime() - approvedAt
  if (
    approval.proposal !== proposalId(proposal) ||
    !Number.isFinite(age) ||
    approvedAt < proposedAt ||
    age < 0 ||
    age > approvalLifetimeMs
  )
    return false
  try {
    return await dependencies.verifyApproval(proposal, approval)
  } catch {
    return false
  }
}

function markUncertain(
  receipts: ActionReceiptStore,
  request: DoneExecutionRequest,
  proposal: string,
): DoneExecutionResult {
  try {
    receipts.markUncertain(request.idempotencyKey, proposal)
  } catch {
    // A pending receipt remains a terminal guard if finalization fails.
  }
  return { status: 'uncertain' }
}

type Prepared =
  | Readonly<{ status: 'ready'; request: DoneExecutionRequest; target: ActionTarget }>
  | Extract<DoneExecutionResult, { status: 'blocked' }>

function scopeExecution(
  request: DoneExecutionRequest,
  dependencies: DoneExecutionDependencies,
): Prepared {
  if (!switchOn(dependencies.enabled)) return { status: 'blocked', reason: 'disabled' }
  const parsed = parseExecutionRequest(request)
  if (parsed.status === 'blocked') return parsed
  if (!isDurableReceiptStore(dependencies.receipts)) {
    return { status: 'blocked', reason: 'receipt_unavailable' }
  }
  const { proposal } = parsed.request
  const [target] = proposal.targets
  if (
    proposal.targets.length !== 1 ||
    target === undefined ||
    !sparkMessageId.test(target.copy.messageId)
  ) {
    return { status: 'blocked', reason: 'invalid_scope' }
  }
  return { status: 'ready', request: parsed.request, target }
}

async function prepareExecution(
  request: DoneExecutionRequest,
  dependencies: DoneExecutionDependencies,
): Promise<Prepared> {
  const scoped = scopeExecution(request, dependencies)
  if (scoped.status === 'blocked') return scoped
  const { proposal, approval } = scoped.request
  if (!(await approvalValid(proposal, approval, dependencies))) {
    return { status: 'blocked', reason: 'approval' }
  }
  try {
    if ((await dependencies.provider.preflight(scoped.target)) !== 'ready') {
      return { status: 'blocked', reason: 'preflight' }
    }
  } catch {
    return { status: 'blocked', reason: 'preflight' }
  }
  if (!(await approvalValid(proposal, approval, dependencies))) {
    return { status: 'blocked', reason: 'approval' }
  }
  return scoped
}

async function completeClaim(
  request: DoneExecutionRequest,
  target: ActionTarget,
  proposalKey: string,
  dependencies: DoneExecutionDependencies,
): Promise<DoneExecutionResult> {
  try {
    try {
      await dependencies.provider.markAsDone(target.copy.messageId)
    } catch {
      // A timeout or error can follow a committed write. Read back anyway.
    }
    if ((await dependencies.provider.readback(target)) !== 'confirmed') {
      return markUncertain(dependencies.receipts, request, proposalKey)
    }
    dependencies.receipts.confirm(
      request.idempotencyKey,
      proposalKey,
      dependencies.now().toISOString(),
    )
    return { status: 'confirmed' }
  } catch {
    return markUncertain(dependencies.receipts, request, proposalKey)
  }
}

/**
 * One ID-only Spark Done attempt. A claim commits before the provider call;
 * any uncertain or pending receipt prevents another automatic attempt on the
 * same ID. Preflight is intentionally not described as atomic: a new message
 * may arrive after it and before Spark acts.
 */
export async function runGuardedMarkAsDone(
  request: DoneExecutionRequest,
  dependencies: DoneExecutionDependencies,
): Promise<DoneExecutionResult> {
  const prepared = await prepareExecution(request, dependencies)
  if (prepared.status === 'blocked') return prepared
  const { request: validated, target } = prepared
  const proposalKey = proposalId(validated.proposal)
  let claim: ReturnType<ActionReceiptStore['claim']>
  try {
    claim = dependencies.receipts.claim(
      validated.idempotencyKey,
      proposalKey,
      target.copy.messageId,
      dependencies.now().toISOString(),
    )
  } catch {
    return { status: 'blocked', reason: 'receipt_unavailable' }
  }
  if (claim !== 'claimed') return { status: 'blocked', reason: claim }
  if (!switchOn(dependencies.enabled))
    return markUncertain(dependencies.receipts, validated, proposalKey)

  return completeClaim(validated, target, proposalKey, dependencies)
}
