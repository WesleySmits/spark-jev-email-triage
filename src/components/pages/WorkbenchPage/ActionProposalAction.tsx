import { useState } from 'react'
import type { DoneApprovalResult, DoneExecutionResult } from '../../../app/done-action'
import {
  admitApproval,
  type ActionApproval,
  type ApprovalRefusal,
  type MailboxActionProposal,
  type TargetObservation,
} from '../../../domain/mailbox-action'
import {
  ActionProposalPanel,
  type ActionStage,
  type PanelAction,
} from '../../organisms/ActionProposalPanel/ActionProposalPanel'
import {
  actionAnnouncement,
  actionEffect,
  actionPreconditions,
  actionResult,
  actionStages,
  actionTargets,
  blockedText,
  standingOf,
  withdrawnAnnouncement,
  type ActionResult,
  type HeldProposal,
  type LabelOf,
} from './action'

export type ProposalDependencies = Readonly<{
  /**
   * What the reading says about that copy's thread now, where it says
   * anything. It is what a held proposal is measured against, so a reading
   * that moves the row on invalidates a proposal made before it.
   */
  observation: TargetObservation | undefined
  /** How a mailbox copy is named here: as the rail names its mailbox. */
  labelOf: LabelOf
  /** Server-owned approval and execution. Omitted in isolated Storybook examples. */
  onApprove?: ((proposal: MailboxActionProposal) => Promise<DoneApprovalResult>) | undefined
  onExecute?:
    | ((request: {
        proposal: MailboxActionProposal
        approval: ActionApproval
        idempotencyKey: string
      }) => Promise<DoneExecutionResult>)
    | undefined
  onConfirmed?: (() => void) | undefined
}>

function outcomeAnnouncement(result: DoneExecutionResult): string {
  if (result.status === 'confirmed') return 'Spark Done confirmed by Archive and Inbox readback.'
  if (result.status === 'uncertain')
    return 'Spark may have changed this message. No automatic retry is allowed.'
  return `${blockedText(result.reason)} No action was requested from Spark.`
}

function executionRequest(
  held: HeldProposal | null,
  stage: string | undefined,
  busy: boolean,
  execution: DoneExecutionResult | null,
) {
  if (!held?.approval || stage !== 'approved' || busy || execution !== null) {
    return null
  }
  return { proposal: held.proposal, approval: held.approval, idempotencyKey: crypto.randomUUID() }
}

/**
 * The proposal one person holds for one row, and the two transitions they
 * may make: proposing, approving, and separately confirming execution.
 *
 * A proposal is kept while the row stays open, including across a reading
 * that lists the mailbox again. That is deliberate: a proposal made against
 * one version of a thread must be seen to lapse when a later message reaches
 * it, rather than quietly following the row onto a version nobody proposed
 * against.
 */
export function useProposal({
  observation,
  onApprove,
  onExecute,
  onConfirmed,
}: ProposalDependencies) {
  const [held, setHeld] = useState<HeldProposal | null>(null)
  const [refusal, setRefusal] = useState<ApprovalRefusal | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const [busy, setBusy] = useState(false)
  const [execution, setExecution] = useState<DoneExecutionResult | null>(null)
  const observations = observation === undefined ? [] : [observation]
  const standing = standingOf(held, observations)
  const settle = (next: HeldProposal | null, reason: ApprovalRefusal | null) => {
    setHeld(next)
    setRefusal(reason)
    setAnnouncement(actionAnnouncement(actionResult(standingOf(next, observations), reason)))
  }
  return {
    held,
    refusal,
    busy,
    execution,
    /**
     * What happened here, and a lapse whether or not anyone made it happen.
     * A proposal goes out of date because a reading brought a later message,
     * not because anyone pressed anything, so the lapse is what this says
     * from then on: a live region must never be left saying something the
     * panel beside it contradicts.
     */
    announcement:
      standing?.stage === 'invalidated'
        ? actionAnnouncement(actionResult(standing, null))
        : announcement,
    standing,
    observations,
    /**
     * Hold the one proposal a handling decision produced. The decision owns
     * what is proposed and against which version; nothing is proposed here
     * on its own, and holding one still permits nothing.
     */
    propose: (proposal: MailboxActionProposal) => {
      setExecution(null)
      settle({ proposal, approval: null }, null)
    },
    /**
     * Approving, which is its own transition and its own refusal. The
     * approval names the exact proposal; one of a version the row has moved
     * past is refused here rather than kept as though it still held.
     */
    approve: async () => {
      if (held === null || busy || onApprove === undefined) return
      if (standing?.stage === 'invalidated') return
      setBusy(true)
      try {
        const result = await onApprove(held.proposal)
        if (result.status === 'blocked') {
          setAnnouncement(`${blockedText(result.reason)} No mail changed.`)
          return
        }
        const admission = admitApproval(held.proposal, result.approval, observations)
        if (admission.status === 'refused') {
          settle(held, admission.reason)
          return
        }
        settle({ ...held, approval: result.approval }, null)
      } catch {
        setAnnouncement('Approval could not be confirmed. No mail changed.')
      } finally {
        setBusy(false)
      }
    },
    execute: async () => {
      const request = executionRequest(held, standing?.stage, busy, execution)
      if (request === null || onExecute === undefined) return
      setBusy(true)
      try {
        const result = await onExecute(request)
        setExecution(result)
        setAnnouncement(outcomeAnnouncement(result))
        if (result.status === 'confirmed') onConfirmed?.()
      } catch {
        setExecution({ status: 'uncertain' })
        setAnnouncement('The result is uncertain. No automatic retry is allowed.')
      } finally {
        setBusy(false)
      }
    },
    withdraw: () => {
      if (busy || execution?.status === 'uncertain' || execution?.status === 'confirmed') return
      setHeld(null)
      setRefusal(null)
      setExecution(null)
      setAnnouncement(withdrawnAnnouncement)
    },
  } as const
}

/** Everything one row's guarded Done path holds, as the hook keeps it. */
export type Held = ReturnType<typeof useProposal>

/**
 * Approve, then separately confirm execution. Nothing here proposes or
 * withdraws: the handling decision above the panel owns both, so one message
 * never carries two ways of asking for the same Spark Done.
 */
function buttonsFor(state: Held, connected: boolean): readonly PanelAction[] {
  if (state.held === null) return []
  return [...approvalButton(state, connected), ...executeButton(state, connected)]
}

function approvalButton(state: Held, connected: boolean): readonly PanelAction[] {
  if (!connected || state.standing?.stage === 'approved') return []
  return [
    {
      id: 'approve',
      label: 'Approve',
      variant: 'secondary',
      disabled: state.standing?.stage === 'invalidated' || state.busy,
      onClick: () => {
        void state.approve()
      },
    },
  ]
}

function executeButton(state: Held, connected: boolean): readonly PanelAction[] {
  if (!connected || state.standing?.stage !== 'approved') return []
  return [
    {
      id: 'execute',
      label: state.busy ? 'Working…' : 'Confirm and run Spark Done',
      variant: 'primary',
      disabled: state.busy || state.execution !== null,
      onClick: () => {
        void state.execute()
      },
    },
  ]
}

function executionStageFor(
  result: DoneExecutionResult | null,
  fallback: ActionStage | undefined,
): ActionStage | undefined {
  if (result === null) return fallback
  if (result.status === 'confirmed')
    return {
      id: 'execution',
      name: 'Execution',
      state: { label: 'Confirmed', tone: 'done' },
      detail: 'Spark Done was read back in Archive and absent from Inbox.',
    }
  if (result.status === 'uncertain')
    return {
      id: 'execution',
      name: 'Execution',
      state: { label: 'Uncertain', tone: 'danger' },
      detail: 'The mailbox may have changed. This attempt cannot be retried automatically.',
    }
  return {
    id: 'execution',
    name: 'Execution',
    state: { label: 'Blocked', tone: 'neutral' },
    detail: 'No Spark action was sent. Use Change decision above to make a new choice.',
  }
}

function resultFor(state: Held, connected: boolean): ActionResult {
  const result = state.execution
  if (result === null) return actionResult(state.standing, state.refusal, connected)
  if (result.status === 'confirmed')
    return {
      title: 'Done confirmed',
      detail: 'The selected message ID was found in Archive and absent from Inbox.',
    }
  if (result.status === 'uncertain')
    return {
      title: 'Result uncertain',
      detail: 'Check Spark manually. This attempt is locked against another automatic run.',
    }
  return {
    title: 'Done blocked',
    detail: `${blockedText(result.reason)} No Spark action was sent.`,
  }
}

/**
 * The mailbox action panel for the open message: the three stages of the one
 * proposal a handling decision produced, approval, and the separate
 * confirmation that requests one guarded provider attempt. Only a confirmed
 * Archive/Inbox readback is shown as Done.
 *
 * It renders nothing that proposes: a person asks for Spark Done by deciding
 * Handle now above it, which is the only way into this path.
 */
export function ActionProposalView({
  state,
  labelOf,
  connected,
}: Readonly<{ state: Held; labelOf: LabelOf; connected: boolean }>) {
  const stages = actionStages(state.held, state.standing, connected)
  const executionStage = executionStageFor(state.execution, stages[2])
  return (
    <>
      <ActionProposalPanel
        headingLevel={3}
        title="Mailbox action"
        summary="Spark Done acts on a message ID. The mailbox shown here is context, not a write boundary. A new message could arrive between check and action."
        stages={[...stages.slice(0, 2), ...(executionStage === undefined ? [] : [executionStage])]}
        targetsTitle="Selected from"
        targets={actionTargets(state.held, state.observations, labelOf)}
        targetsNote="Spark receives the message ID, not the mailbox ID. Another visible copy may change too."
        targetsEmpty="Nothing is proposed, so no mailbox copy is named."
        effect={actionEffect(state.held, labelOf)}
        preconditionsTitle="Before anything could run"
        preconditions={actionPreconditions(
          state.held,
          state.standing,
          state.observations,
          labelOf,
          connected,
        )}
        actions={buttonsFor(state, connected)}
        result={resultFor(state, connected)}
      />
      {/* The panel announces nothing itself, so its caller says what happened. */}
      <p className="workbench__action-status" role="status">
        {state.announcement}
      </p>
    </>
  )
}
