import { useState } from 'react'
import type { DoneApprovalResult, DoneExecutionResult } from '../../../app/done-action'
import {
  admitApproval,
  proposeMailboxAction,
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
  standingOf,
  withdrawnAnnouncement,
  type ActionResult,
  type HeldProposal,
  type LabelOf,
  type Proposable,
} from './action'

type ActionProposalActionProps = Readonly<{
  /**
   * What a proposal about the open row may name: the one mailbox copy it
   * would be applied to, and the judgment that explains it. Left out where
   * the row names no version anyone could propose against, which is when
   * proposing is offered and refused rather than hidden.
   */
  proposable: Proposable | undefined
  /**
   * What the reading says about that copy's thread now, where it says
   * anything. It is what a held proposal is measured against, so a reading
   * that moves the row on invalidates a proposal made before it.
   */
  observation: TargetObservation | undefined
  /** How this computer names the person approving. Never a mailbox address. */
  approver: string
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

/** The clock the proposal and the approval are stamped with. */
const now = () => new Date().toISOString()

const blockedMessages: Readonly<Record<string, string>> = {
  disabled: 'Done actions are switched off on this computer.',
  invalid_scope: 'This selected message cannot be acted on.',
  approval: 'The approval expired or no longer matches this proposal.',
  preflight: 'Spark could not confirm the selected message and thread are unchanged.',
  receipt_unavailable: 'The local action record is unavailable.',
  journal_unavailable: 'The local action record is unavailable.',
  replay: 'This message already has an action attempt. Check Spark manually.',
  conflict: 'This message already has an action attempt. Check Spark manually.',
  local_only: 'Done is available only from this local app.',
  origin: 'Done is available only from this local app.',
}
const blockedText = (reason: string) => blockedMessages[reason] ?? 'Done could not proceed.'

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
function useProposal({
  proposable,
  observation,
  onApprove,
  onExecute,
  onConfirmed,
}: ActionProposalActionProps) {
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
    propose: () => {
      if (proposable === undefined) return
      setExecution(null)
      settle(
        {
          proposal: proposeMailboxAction({
            kind: 'markAsDone',
            scope: 'spark-message-id',
            targets: [proposable.target],
            basis: proposable.basis,
            proposedAt: now(),
          }),
          approval: null,
        },
        null,
      )
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

type Held = ReturnType<typeof useProposal>

const terminal = (result: DoneExecutionResult | null) =>
  result?.status === 'confirmed' || result?.status === 'uncertain'

/** Propose, approve, then separately confirm execution. */
function buttonsFor(state: Held, canPropose: boolean, connected: boolean): readonly PanelAction[] {
  if (state.held === null) {
    return [
      {
        id: 'propose',
        label: 'Propose Spark Done',
        variant: 'secondary',
        disabled: !canPropose,
        onClick: state.propose,
      },
    ]
  }
  return [
    ...approvalButton(state, connected),
    ...executeButton(state, connected),
    {
      id: 'withdraw',
      label: 'Withdraw',
      variant: 'quiet',
      disabled: state.busy || terminal(state.execution),
      onClick: state.withdraw,
    },
  ]
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
    detail: 'No Spark action was sent. Withdraw this proposal to start again.',
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
 * The mailbox action panel for the open message. Approval is persisted by the
 * server; a second click requests one guarded provider attempt. Only a
 * confirmed Archive/Inbox readback is shown as Done.
 *
 * Give it a new `key` per row, so one message's proposal never carries to
 * the next.
 */
export function ActionProposalAction(props: ActionProposalActionProps) {
  const state = useProposal(props)
  const stages = actionStages(state.held, state.standing, props.onExecute !== undefined)
  const executionStage = executionStageFor(state.execution, stages[2])
  return (
    <>
      <ActionProposalPanel
        headingLevel={3}
        title="Mailbox action"
        summary="Spark Done acts on a message ID. The mailbox shown here is context, not a write boundary. A new message could arrive between check and action."
        stages={[...stages.slice(0, 2), ...(executionStage === undefined ? [] : [executionStage])]}
        targetsTitle="Selected from"
        targets={actionTargets(state.held, state.observations, props.labelOf)}
        targetsNote="Spark receives the message ID, not the mailbox ID. Another visible copy may change too."
        targetsEmpty="Nothing is proposed, so no mailbox copy is named."
        effect={actionEffect(state.held, props.labelOf)}
        preconditionsTitle="Before anything could run"
        preconditions={actionPreconditions(
          state.held,
          state.standing,
          state.observations,
          props.labelOf,
          props.onExecute !== undefined,
        )}
        actions={buttonsFor(state, props.proposable !== undefined, props.onExecute !== undefined)}
        result={resultFor(state, props.onExecute !== undefined)}
      />
      {/* The panel announces nothing itself, so its caller says what happened. */}
      <p className="workbench__action-status" role="status">
        {state.announcement}
      </p>
    </>
  )
}
