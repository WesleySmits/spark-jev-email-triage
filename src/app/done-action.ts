/** Browser-safe request and outcome shapes for one reviewed Spark Done action. */
import { z } from 'zod'
import {
  parseActionApproval,
  parseMailboxActionProposal,
  type ActionApproval,
  type MailboxActionProposal,
} from '../domain/mailbox-action'

const proposal = z.unknown().transform((value, context) => {
  const parsed = parseMailboxActionProposal(value)
  if (parsed !== null) return parsed
  context.addIssue({ code: 'custom', message: 'Invalid proposal' })
  return z.NEVER
})

const approval = z.unknown().transform((value, context) => {
  const parsed = parseActionApproval(value)
  if (parsed !== null) return parsed
  context.addIssue({ code: 'custom', message: 'Invalid approval' })
  return z.NEVER
})

export const doneApprovalRequestSchema = z.strictObject({ proposal })
export const doneExecutionRequestSchema = z.strictObject({
  proposal,
  approval,
  idempotencyKey: z.uuid(),
})

export type DoneApprovalRequest = Readonly<{ proposal: MailboxActionProposal }>
export type DoneExecutionRequest = Readonly<{
  proposal: MailboxActionProposal
  approval: ActionApproval
  idempotencyKey: string
}>

export type DoneApprovalResult =
  | Readonly<{ status: 'approved'; approval: ActionApproval }>
  | Readonly<{
      status: 'blocked'
      reason:
        'disabled' | 'invalid_scope' | 'preflight' | 'journal_unavailable' | 'local_only' | 'origin'
    }>

export type DoneExecutionResult =
  | Readonly<{ status: 'confirmed' }>
  | Readonly<{ status: 'uncertain' }>
  | Readonly<{
      status: 'blocked'
      reason:
        | 'disabled'
        | 'invalid_scope'
        | 'approval'
        | 'preflight'
        | 'journal_unavailable'
        | 'replay'
        | 'conflict'
        | 'local_only'
        | 'origin'
    }>
