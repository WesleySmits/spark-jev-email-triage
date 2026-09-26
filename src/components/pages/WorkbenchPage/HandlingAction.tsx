import { useState } from 'react'
import { decideHandling, handlingRequest, type HandlingOutcome } from '../../../domain/handling'
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
  }>

/** The clock a decision, and the proposal it produces, are stamped with. */
const now = () => new Date().toISOString()

/**
 * The handling step for the open message, and the guarded Spark Done path it
 * can start.
 *
 * One decision is recorded at a time, about the exact version the reading
 * names. Three of the four outcomes change nothing outside this app. The
 * fourth, Handle now, is the only way into Spark Done here: it produces one
 * proposal through the domain's handling model, and that proposal still
 * needs the server's approval, a fresh preflight, a durable receipt and a
 * readback before anything is called done. Nothing is stored: a decision is
 * kept while the row stays open, and the copy says so.
 *
 * A decision whose action was blocked, lapsed or left uncertain keeps saying
 * the work is open. An uncertain attempt also locks the decision, because
 * changing it would suggest a settled state this app cannot prove.
 *
 * Give it a new `key` per row, so one message's decision never carries to
 * the next.
 */
export function HandlingAction({ proposable, ...dependencies }: HandlingActionProps) {
  const state = useProposal(dependencies)
  const [chosen, setChosen] = useState<HandlingOutcome | null>(null)
  const [decided, setDecided] = useState<HandlingOutcome | null>(null)
  const [cleared, setCleared] = useState(false)
  const connected = dependencies.onExecute !== undefined
  const view = decided === null ? null : recordedDecision(decided, state.standing, state.execution)
  const record = () => {
    if (chosen === null || proposable === undefined) return
    const request = handlingRequest(
      decideHandling({
        outcome: chosen,
        target: proposable.target,
        basis: proposable.basis,
        decidedAt: now(),
      }),
    )
    setCleared(false)
    setDecided(request.outcome)
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
        note={handlingNote(proposable?.target.copy.messageId)}
        recordLabel="Record decision"
        onRecord={record}
        recordDisabled={chosen === null || proposable === undefined}
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
