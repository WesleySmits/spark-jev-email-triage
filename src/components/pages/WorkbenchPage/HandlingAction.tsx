import { useId, useState } from 'react'
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
import { storedView } from './work-save'
import { dueInstant, useWorkSave, type WorkSaving } from './useWorkSave'

type HandlingActionProps = ProposalDependencies &
  Readonly<{
    /**
     * The one mailbox copy and thread version a decision about the open row
     * may name, and the judgment that explains it. Left out where the
     * reading names no version, which is when the outcomes are offered and
     * refused in words rather than hidden.
     */
    proposable: Proposable | undefined
    /** Where work decisions are saved, and what was saved for this copy. Left out: none are. */
    work?: WorkSaving | undefined
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
 * readback before anything is called done. Reply needed, Follow up later
 * and Handled in Spark are saved to the local work record where `work` is
 * given, and the panel follows the store's answer; what the record already
 * held for this copy is shown above the chooser.
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
export function HandlingAction({ proposable, work, ...dependencies }: HandlingActionProps) {
  const state = useProposal(dependencies)
  const workSave = useWorkSave(work)
  const [due, setDue] = useState('')
  const [chosen, setChosen] = useState<HandlingOutcome | null>(null)
  const [decided, setDecided] = useState<HandlingDecision | null>(null)
  const [cleared, setCleared] = useState(false)
  const connected = dependencies.onExecute !== undefined
  const view =
    decided === null
      ? null
      : recordedDecision(
          decided.outcome,
          targetStanding(decided.target, state.observations),
          state.standing,
          state.execution,
          workSave.saved,
        )
  const record = () => {
    if (chosen === null || proposable === undefined) return
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
    else workSave.save(chosen, proposable.target, dueInstant(due))
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
        note={handlingNote(proposable?.target.copy.messageId, work !== undefined)}
        field={
          work !== undefined &&
          (chosen === 'reply_needed' || chosen === 'follow_up_later') && (
            <DueField value={due} onChange={setDue} />
          )
        }
        saved={savedReadback(work)}
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

/** What the record already held for this copy, as the panel shows it. */
function savedReadback(work: WorkSaving | undefined) {
  const view = storedView(work?.stored)
  return view === null ? undefined : { heading: 'Saved in Open work', ...view }
}

type DueFieldProps = Readonly<{ value: string; onChange: (value: string) => void }>

/** An optional date the work is owed by. Left empty, it is owed by no date. */
function DueField({ value, onChange }: DueFieldProps) {
  const id = useId()
  return (
    <p className="handling-panel__field">
      <label htmlFor={id}>Due date (optional)</label>
      <input
        id={id}
        type="date"
        value={value}
        onChange={(event) => {
          onChange(event.target.value)
        }}
      />
    </p>
  )
}
