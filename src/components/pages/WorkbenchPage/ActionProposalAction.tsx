import { useState } from 'react'
import {
  admitApproval,
  approveProposal,
  proposeMailboxAction,
  type ApprovalRefusal,
  type TargetObservation,
} from '../../../domain/mailbox-action'
import {
  ActionProposalPanel,
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
}>

/** The clock the proposal and the approval are stamped with. */
const now = () => new Date().toISOString()

/**
 * The proposal one person holds for one row, and the two transitions they
 * may make: proposing, and then approving. Both are theirs to make, and
 * neither reaches a mailbox.
 *
 * A proposal is kept while the row stays open, including across a reading
 * that lists the mailbox again. That is deliberate: a proposal made against
 * one version of a thread must be seen to lapse when a later message reaches
 * it, rather than quietly following the row onto a version nobody proposed
 * against.
 */
function useProposal({ proposable, observation, approver }: ActionProposalActionProps) {
  const [held, setHeld] = useState<HeldProposal | null>(null)
  const [refusal, setRefusal] = useState<ApprovalRefusal | null>(null)
  const [announcement, setAnnouncement] = useState('')
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
      settle(
        {
          proposal: proposeMailboxAction({
            kind: 'archive',
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
    approve: () => {
      if (held === null) return
      const approval = approveProposal(held.proposal, { approvedBy: approver, approvedAt: now() })
      const admission = admitApproval(held.proposal, approval, observations)
      if (admission.status === 'refused') {
        settle(held, admission.reason)
        return
      }
      settle({ ...held, approval }, null)
    },
    withdraw: () => {
      setHeld(null)
      setRefusal(null)
      setAnnouncement(withdrawnAnnouncement)
    },
  } as const
}

type Held = ReturnType<typeof useProposal>

/** Propose while nothing is held; approve and withdraw once one is. */
function buttonsFor(state: Held, canPropose: boolean): readonly PanelAction[] {
  if (state.held === null) {
    return [
      {
        id: 'propose',
        label: 'Propose archive',
        variant: 'secondary',
        disabled: !canPropose,
        onClick: state.propose,
      },
    ]
  }
  const approve: readonly PanelAction[] =
    state.standing?.stage === 'approved'
      ? []
      : [
          {
            id: 'approve',
            label: 'Approve',
            variant: 'secondary',
            disabled: state.standing?.stage === 'invalidated',
            onClick: state.approve,
          },
        ]
  return [
    ...approve,
    { id: 'withdraw', label: 'Withdraw', variant: 'quiet', onClick: state.withdraw },
  ]
}

/**
 * The mailbox action panel for the open message: what is proposed, what a
 * person approved, and that execution is blocked, as three stages that never
 * read as one another.
 *
 * Nothing here reaches a mailbox. Proposing names one copy and no other,
 * approving is a person's decision recorded on this page, and execution has
 * no path at all: this build has no write adapter, so every state says the
 * mailbox is unchanged and none of them says a message was archived.
 *
 * Give it a new `key` per row, so one message's proposal never carries to
 * the next.
 */
export function ActionProposalAction(props: ActionProposalActionProps) {
  const state = useProposal(props)
  return (
    <>
      <ActionProposalPanel
        headingLevel={3}
        title="Mailbox action"
        summary="Proposed here, approved by you, and never carried out."
        stages={actionStages(state.held, state.standing)}
        targetsTitle="Mailbox copies named"
        targets={actionTargets(state.held, state.observations, props.labelOf)}
        targetsNote="Only the copies named here would be acted on, by the mailbox and message ids shown. The same message in another mailbox is a separate copy, and nothing adds it for you."
        targetsEmpty="Nothing is proposed, so no mailbox copy is named."
        effect={actionEffect(state.held, props.labelOf)}
        preconditionsTitle="Before anything could run"
        preconditions={actionPreconditions(
          state.held,
          state.standing,
          state.observations,
          props.labelOf,
        )}
        actions={buttonsFor(state, props.proposable !== undefined)}
        result={actionResult(state.standing, state.refusal)}
      />
      {/* The panel announces nothing itself, so its caller says what happened. */}
      <p className="workbench__action-status" role="status">
        {state.announcement}
      </p>
    </>
  )
}
