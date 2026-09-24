import { useState, type SyntheticEvent } from 'react'
import type { TriageClientState } from '../../../app/triage-run-client'
import type { TriageRunItemStatus, TriageRunSnapshot } from '../../../app/triage-run'
import { Badge } from '../../atoms/Badge/Badge'
import { Button } from '../../atoms/Button/Button'
import './TriageRunControl.css'

type TriageRunControlProps = Readonly<{
  worklistSize: number
  state: TriageClientState
  onStart: (limits: { maxMessages: number; maxJevCalls: number }) => void
  onResume: () => void
  onRead: () => void
  onStop: () => void
  onRestart: () => void
  onForget: () => void
}>

const activeStatuses = new Set<TriageRunSnapshot['status']>(['queued', 'running', 'stopping'])

const statusView: Record<
  TriageRunSnapshot['status'],
  Readonly<{ label: string; tone: 'review' | 'done' | 'danger'; detail: string }>
> = {
  queued: { label: 'Queued', tone: 'review', detail: 'The bounded selection is waiting to run.' },
  running: { label: 'Running', tone: 'review', detail: 'Jev is triaging the bounded selection.' },
  stopping: {
    label: 'Stopping safely',
    tone: 'review',
    detail: 'No new classification will start; in-flight work may still settle.',
  },
  stopped: {
    label: 'Stopped',
    tone: 'review',
    detail: 'The run stopped safely. Deferred messages were not sent to Jev.',
  },
  completed: {
    label: 'Completed',
    tone: 'done',
    detail: 'The bounded run completed and its result is stored locally.',
  },
  partial: {
    label: 'Partial',
    tone: 'review',
    detail: 'Some results were stored; failures or deferred messages remain visible below.',
  },
  failed: {
    label: 'Failed',
    tone: 'danger',
    detail: 'The run failed. Readback preserves the evidence that was stored.',
  },
  interrupted: {
    label: 'Interrupted',
    tone: 'danger',
    detail: 'The process ended before the run recorded a final result.',
  },
}

const itemLabels: Record<TriageRunItemStatus, string> = {
  queued: 'Queued',
  already_current: 'Already current',
  duplicate: 'Same thread',
  classified: 'Classified',
  provider_failure: 'Provider failed',
  read_error: 'Read failed',
  store_error: 'Store failed',
  deferred: 'Deferred',
}

const blockedLabels: Record<NonNullable<TriageClientState['blockedReason']>, string> = {
  disabled: 'Manual Jev runs are disabled on this computer.',
  local_only: 'Manual Jev runs are available only from this computer.',
  missing_credentials: 'Jev credentials are not configured.',
  stale_worklist: 'This loaded worklist is no longer available. Refresh mail before starting.',
  empty_scope: 'There are no messages in this selection.',
  mailbox_unavailable: 'The selected mailbox is not readable.',
  store_unavailable: 'The local run store is unavailable.',
  run_unavailable: 'The earlier run is no longer available.',
  run_in_progress: 'Another manual run is already active.',
  request_mismatch: 'The saved request does not match the server record.',
}

const boundedDefault = (worklistSize: number) => Math.max(1, Math.min(25, worklistSize))

function RunForm({
  worklistSize,
  disabled,
  onStart,
}: Pick<TriageRunControlProps, 'worklistSize' | 'onStart'> & Readonly<{ disabled: boolean }>) {
  const initial = boundedDefault(worklistSize)
  const [maxMessages, setMaxMessages] = useState(initial)
  const [maxJevCalls, setMaxJevCalls] = useState(initial)
  const submit = (event: SyntheticEvent<HTMLFormElement, SubmitEvent>) => {
    event.preventDefault()
    onStart({ maxMessages, maxJevCalls })
  }
  return (
    <form className="triage-run__form" onSubmit={submit}>
      <label>
        <span>Messages</span>
        <input
          aria-label="Maximum messages"
          type="number"
          min={1}
          max={100}
          value={maxMessages}
          disabled={disabled}
          onChange={(event) => {
            setMaxMessages(Number(event.currentTarget.value))
          }}
        />
      </label>
      <label>
        <span>Jev calls</span>
        <input
          aria-label="Maximum Jev calls"
          type="number"
          min={1}
          max={100}
          value={maxJevCalls}
          disabled={disabled}
          onChange={(event) => {
            setMaxJevCalls(Number(event.currentTarget.value))
          }}
        />
      </label>
      <Button type="submit" disabled={disabled || worklistSize === 0}>
        Start Jev triage
      </Button>
    </form>
  )
}

function RunEvidence({ run }: Readonly<{ run: TriageRunSnapshot }>) {
  const view = statusView[run.status]
  const progress = run.counts.selected === 0 ? 0 : run.counts.processed
  return (
    <>
      <div className="triage-run__head">
        <h3 className="triage-run__title">Jev run</h3>
        <Badge tone={view.tone}>{view.label}</Badge>
      </div>
      <p className="triage-run__detail">{view.detail}</p>
      <progress
        aria-label="Jev triage progress"
        max={Math.max(1, run.counts.selected)}
        value={progress}
      />
      <dl className="triage-run__facts">
        <div>
          <dt>Progress</dt>
          <dd>
            {run.counts.processed} / {run.counts.selected}
          </dd>
        </div>
        <div>
          <dt>Jev calls</dt>
          <dd>
            {run.cost.jevCalls} / {run.limits.maxJevCalls}
          </dd>
        </div>
        <div>
          <dt>Tokens</dt>
          <dd>{run.cost.inputTokens + run.cost.outputTokens}</dd>
        </div>
        <div>
          <dt>Errors</dt>
          <dd>{run.counts.errors}</dd>
        </div>
      </dl>
      <p className="triage-run__meta">
        Run <code>{run.runId}</code> · price unavailable
      </p>
      {!activeStatuses.has(run.status) && run.items.length > 0 && (
        <details className="triage-run__results">
          <summary>Results by message</summary>
          <ul role="list">
            {run.items.map((item) => (
              <li key={`${item.mailbox}:${item.messageId}`}>
                <span>{itemLabels[item.status]}</span>
                <code>{item.messageId}</code>
                {item.category && <span>{item.category}</span>}
                {item.priority && <span>{item.priority}</span>}
                {item.needsReview && <span>Needs review</span>}
              </li>
            ))}
          </ul>
        </details>
      )}
      {run.errorCodes.length > 0 && (
        <p className="triage-run__errors">Reported: {run.errorCodes.join(', ')}</p>
      )}
    </>
  )
}

function EmptyRunHeading({ state }: Readonly<{ state: TriageClientState }>) {
  const reading = state.phase === 'restoring' || state.phase === 'reading'
  const blocked = state.phase === 'blocked'
  return (
    <div className="triage-run__head">
      <h3 className="triage-run__title">Jev run</h3>
      <Badge tone={blocked ? 'danger' : 'neutral'}>
        {reading ? 'Reading back' : blocked ? 'Blocked' : 'Not started'}
      </Badge>
    </div>
  )
}

type RunFeedbackView = Readonly<{ text: string; tone?: 'danger' | 'attention' }>

const phaseFeedback: Partial<Record<TriageClientState['phase'], RunFeedbackView>> = {
  restoring: { text: 'Checking this browser for an earlier run. No Jev work is started.' },
  idle: {
    text: 'Explicitly triage this loaded worklist. Opening and refreshing never starts Jev.',
  },
  absent: { text: 'The saved run was not found. No new run was started.', tone: 'danger' },
  unavailable: {
    text: 'Readback did not answer. The saved run ID is kept; try readback again.',
    tone: 'danger',
  },
  stopping: { text: 'Requesting a safe stop…' },
  reading: { text: 'Reading the stored result…' },
  starting: { text: 'Sending the explicit request…' },
  restarting: { text: 'Sending the explicit request…' },
}

function feedbackFor(state: TriageClientState): RunFeedbackView | undefined {
  if (state.phase === 'blocked' && state.blockedReason) {
    return { text: blockedLabels[state.blockedReason], tone: 'danger' }
  }
  if (state.phase === 'uncertain' && state.pending) {
    const operation = state.pending.kind === 'restart' ? 'restart' : 'start'
    return {
      text: `The ${operation} response is unknown. Resume the same request; a second request is disabled.`,
      tone: 'attention',
    }
  }
  return phaseFeedback[state.phase]
}

function RunFeedback({ state }: Readonly<{ state: TriageClientState }>) {
  const feedback = feedbackFor(state)
  if (feedback === undefined) return null
  const modifier = feedback.tone ? ` triage-run__feedback--${feedback.tone}` : ''
  return (
    <p className={`triage-run__feedback${modifier}`} role="status">
      {feedback.text}
    </p>
  )
}

type RunActionsProps = Pick<
  TriageRunControlProps,
  'state' | 'onResume' | 'onRead' | 'onStop' | 'onRestart' | 'onForget'
>

function RunActions({ state, onResume, onRead, onStop, onRestart, onForget }: RunActionsProps) {
  const active = isActive(state.run)
  const busy = isBusy(state)
  const uncertain = isUncertain(state)

  if (uncertain) {
    return (
      <div className="triage-run__actions">
        <Button onClick={onResume} disabled={busy}>
          Resume same request
        </Button>
      </div>
    )
  }
  if (state.phase === 'absent' || state.phase === 'unavailable') {
    return (
      <div className="triage-run__actions">
        <Button variant="secondary" onClick={onRead} disabled={busy}>
          Try readback
        </Button>
      </div>
    )
  }
  if (active) {
    return (
      <div className="triage-run__actions">
        <Button
          variant="secondary"
          onClick={onStop}
          disabled={busy || state.run?.status === 'stopping'}
        >
          Stop safely
        </Button>
      </div>
    )
  }
  if (state.run) {
    return (
      <div className="triage-run__actions">
        <Button onClick={onRestart} disabled={busy}>
          Restart exact selection
        </Button>
        <Button variant="secondary" onClick={onRead} disabled={busy}>
          Read back
        </Button>
        <Button variant="quiet" onClick={onForget} disabled={busy}>
          Hide run
        </Button>
      </div>
    )
  }
  return null
}

/** Compact workbench control; it never starts work except from a labelled button. */
export function TriageRunControl({
  worklistSize,
  state,
  onStart,
  onResume,
  onRead,
  onStop,
  onRestart,
  onForget,
}: TriageRunControlProps) {
  const showForm = canStartNewRun(state)
  return (
    <section className="triage-run" aria-label="Jev triage run">
      {state.run ? <RunEvidence run={state.run} /> : <EmptyRunHeading state={state} />}
      <RunFeedback state={state} />
      <RunActions
        state={state}
        onResume={onResume}
        onRead={onRead}
        onStop={onStop}
        onRestart={onRestart}
        onForget={onForget}
      />
      {showForm && (
        <RunForm worklistSize={worklistSize} disabled={isBusy(state)} onStart={onStart} />
      )}
    </section>
  )
}

function isActive(run: TriageRunSnapshot | undefined) {
  return run !== undefined && activeStatuses.has(run.status)
}

function isBusy(state: TriageClientState) {
  return ['starting', 'restarting', 'reading', 'stopping'].includes(state.phase)
}

function isUncertain(state: TriageClientState) {
  return state.phase === 'uncertain' && state.pending !== undefined
}

function canStartNewRun(state: TriageClientState) {
  const unsafePhase = ['restoring', 'reading', 'unavailable'].includes(state.phase)
  const unsafeBlock =
    state.phase === 'blocked' &&
    (state.blockedReason === 'run_in_progress' || state.blockedReason === 'request_mismatch')
  return !isActive(state.run) && !isUncertain(state) && !unsafePhase && !unsafeBlock
}
