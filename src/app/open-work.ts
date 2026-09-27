import { z } from 'zod'
import { actionTargetSchema } from '../domain/mailbox-action'
import { mailboxCopyRefSchema } from '../domain/mailbox-copy'
import { followUpKinds } from '../domain/follow-up'
import type { OpenWorkItem, OpenWorkTally } from '../domain/open-work'

export const workDecisionRequestSchema = z.strictObject({
  target: actionTargetSchema,
  kind: z.enum(followUpKinds),
  dueAt: z.iso.datetime({ offset: true }).nullable(),
  requestId: z.uuid(),
})

export type WorkDecisionRequest = z.infer<typeof workDecisionRequestSchema>
export type WorkDecisionResult =
  | Readonly<{ status: 'recorded' }>
  | Readonly<{
      status: 'refused'
      reason: 'stale' | 'unverified' | 'nothing_to_reopen' | 'request_conflict'
    }>
  | Readonly<{ status: 'unavailable' | 'unknown' }>

export type OpenWorkRead =
  | Readonly<{
      status: 'ready'
      items: readonly OpenWorkItem[]
      tally: OpenWorkTally
      bounded: boolean
      checkedAt: string
    }>
  | Readonly<{ status: 'unavailable' }>

export const workMessageRequestSchema = z.strictObject({ copy: mailboxCopyRefSchema })
export type WorkMessageRequest = z.infer<typeof workMessageRequestSchema>
export type WorkMessageRead =
  | Readonly<{
      status: 'ready'
      target: z.infer<typeof actionTargetSchema>
      subject: string | null
      messages: readonly Readonly<{
        id: string
        sender: string
        sentAt: string | null
        text: string | null
      }>[]
    }>
  | Readonly<{ status: 'unavailable' }>
