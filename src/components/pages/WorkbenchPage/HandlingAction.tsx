import { useState } from 'react'
import type { WorkDecisionRequest, WorkDecisionResult } from '../../../app/open-work'
import {
  decideHandling,
  handlingRequest,
  type HandlingDecision,
  type HandlingOutcome,
} from '../../../domain/handling'
import { targetStanding } from '../../../domain/mailbox-action'
import { HandlingPanel } from '../../organisms/HandlingPanel/HandlingPanel'
import { ActionProposalView, useProposal, type ProposalDependencies } from './ActionProposalAction'
import type { Proposable } from './action'
import {
  asOutcome,
  handlingNote,
  handlingOptions,
  handlingResult,
  handlingStatus,
  handlingSummary,
  handlingTags,
  handlingTitle,
  recordedDecision,
} from './handling'

type HandlingActionProps = ProposalDependencies &
  Readonly<{
    /**
     * The one mailbox copy and thread version a decision about the open row
     * may name, and the judgment that explains it. Left out where the
     * reading names no version, which is when the outcomes are offered and
     * refused in words rather than hidden.
     */
    proposable: Proposable | undefined
    onRecordWork?: ((request: WorkDecisionRequest) => Promise<WorkDecisionResult>) | undefined
  }>

/** The clock a decision, and the proposal it produces, are stamped with. */
const now = () => new Date().toISOString()

function useFollowUpSave(onRecordWork: HandlingActionProps['onRecordWork']) {
  const [due, setDue] = useState('')
  const [status, setStatus] = useState('')
  const [saving, setSaving] = useState(false)
  const [uncertain, setUncertain] = useState(false)
  const write = async (request: WorkDecisionRequest): Promise<boolean> => {
    if (!onRecordWork || uncertain) return false
    setSaving(true)
    setStatus('')
    const result = await onRecordWork(request)
    setSaving(false)
    setUncertain(result.status === 'unknown')
    setStatus(
      result.status === 'recorded'
        ? request.kind === 'handled_in_spark'
          ? 'Your handled-in-Spark claim was saved locally. No Spark command ran.'
          : 'Saved as local work. Spark mailbox unchanged.'
        : result.status === 'unknown'
          ? 'Save outcome unknown. Check the local record before another decision.'
          : `Decision was not confirmed: ${result.status === 'refused' ? result.reason : result.status}.`,
    )
    return result.status === 'recorded'
  }
  const save = (chosen: HandlingOutcome, proposable: Proposable): Promise<boolean> => {
    if (!onRecordWork || (chosen !== 'reply_needed' && chosen !== 'follow_up_later'))
      return Promise.resolve(true)
    return write({
      target: proposable.target,
      kind: chosen,
      dueAt: due ? new Date(due).toISOString() : null,
      requestId: crypto.randomUUID(),
    })
  }
  const handled = (proposable: Proposable) =>
    write({
      target: proposable.target,
      kind: 'handled_in_spark',
      dueAt: null,
      requestId: crypto.randomUUID(),
    })
  return { due, setDue, status, saving, uncertain, save, handled } as const
}

function decisionView(
  decided: HandlingDecision | null,
  state: ReturnType<typeof useProposal>,
  durable: boolean,
) {
  if (decided === null) return null
  return recordedDecision(
    decided.outcome,
    targetStanding(decided.target, state.observations),
    state.standing,
    state.execution,
    durable,
  )
}

function HandledClaimButton({
  proposable,
  onRecordWork,
  followUp,
}: Readonly<{
  proposable: Proposable | undefined
  onRecordWork: HandlingActionProps['onRecordWork']
  followUp: ReturnType<typeof useFollowUpSave>
}>) {
  if (!onRecordWork || !proposable) return null
  return (
    <button
      type="button"
      disabled={followUp.saving || followUp.uncertain}
      onClick={() => {
        void followUp.handled(proposable)
      }}
    >
      I handled this in Spark
    </button>
  )
}

/**
 * The handling step for the open message, and the guarded Spark Done path it
 * can start.
 *
 * One decision is recorded at a time, about the exact version the reading
 * names. Three of the four outcomes change nothing outside this app. The
 * fourth, Handle now, is the only way into Spark Done here: it produces one
 * proposal through the domain's handling model, and that proposal still
 * needs the server's approval, a fresh preflight, a durable receipt and a
 * readback before anything is called done. Reply needed and Follow up later
 * save local work when the caller connects that store.
 *
 * A decision whose action was blocked, lapsed or left uncertain keeps saying
 * the work is open. An uncertain attempt also locks the decision, because
 * changing it would suggest a settled state this app cannot prove.
 *
 * The decision is kept as the domain records it, against the copy and thread
 * version it named, and is measured against what the reading says about that
 * copy now. This component deliberately survives a new reading of the same
 * row, so a later message must be seen to make the decision out of date
 * rather than silently carry it onto the version that replaced it. That
 * holds for the three outcomes that reach no provider as much as for Handle
 * now: an old answer to "what do I owe this mail" is not an answer about
 * mail that has since been added to.
 *
 * Give it a new `key` per row, so one message's decision never carries to
 * the next.
 */
export function HandlingAction({ proposable, onRecordWork, ...dependencies }: HandlingActionProps) {
  const state = useProposal(dependencies)
  const [chosen, setChosen] = useState<HandlingOutcome | null>(null)
  const [decided, setDecided] = useState<HandlingDecision | null>(null)
  const [cleared, setCleared] = useState(false)
  const followUp = useFollowUpSave(onRecordWork)
  const connected = dependencies.onExecute !== undefined
  const view = decisionView(decided, state, onRecordWork !== undefined)
  const record = async () => {
    if (chosen === null || proposable === undefined) return
    if (!(await followUp.save(chosen, proposable))) return
    const decision = decideHandling({
      outcome: chosen,
      target: proposable.target,
      basis: proposable.basis,
      decidedAt: now(),
    })
    const request = handlingRequest(decision)
    setCleared(false)
    setDecided(decision)
    if (request.proposal !== null) state.propose(request.proposal)
  }
  const announced = handlingStatus(view, cleared)
  const change = () => {
    if (view?.locked === true || state.busy) return
    state.withdraw()
    setDecided(null)
    setCleared(true)
  }
  return (
    <>
      <HandlingPanel
        headingLevel={3}
        title={handlingTitle}
        summary={handlingSummary}
        options={handlingOptions(
          connected ? 'available' : 'not_connected',
          proposable !== undefined,
        )}
        chosen={chosen}
        onChoose={(value) => {
          setChosen(asOutcome(value))
        }}
        note={handlingNote(proposable?.target.copy.messageId, onRecordWork !== undefined)}
        recordLabel="Record decision"
        onRecord={() => {
          void record()
        }}
        recordDisabled={
          chosen === null || proposable === undefined || followUp.saving || followUp.uncertain
        }
        recorded={
          view === null
            ? undefined
            : {
                ...view,
                changeLabel: 'Change decision',
                onChange: change,
                changeDisabled: view.locked || state.busy,
              }
        }
        tags={handlingTags(view)}
        result={handlingResult(proposable !== undefined)}
      />
      {onRecordWork && (chosen === 'reply_needed' || chosen === 'follow_up_later') && (
        <label>
          Optional due date{' '}
          <input
            type="datetime-local"
            value={followUp.due}
            onChange={(event) => {
              followUp.setDue(event.target.value)
            }}
          />
        </label>
      )}
      <HandledClaimButton proposable={proposable} onRecordWork={onRecordWork} followUp={followUp} />
      <p role="status">{followUp.status}</p>
      {/* The panel announces nothing itself, so its caller says what happened. */}
      <p className="workbench__handling-status" role="status">
        {announced}
      </p>
      {connected && (
        <ActionProposalView state={state} labelOf={dependencies.labelOf} connected={connected} />
      )}
    </>
  )
}
