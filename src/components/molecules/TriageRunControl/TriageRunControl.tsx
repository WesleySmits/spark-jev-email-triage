import { useEffect, useRef, useState, type MouseEvent, type SyntheticEvent } from 'react'
import type { BatchProgress, TriageClientState } from '../../../app/triage-run-client'
import type { TriageRunItemStatus, TriageRunSnapshot } from '../../../app/triage-run'
import { Badge } from '../../atoms/Badge/Badge'
import { Button } from '../../atoms/Button/Button'
import './TriageRunControl.css'

type TriageRunControlProps = Readonly<{
  worklistSize: number
  state: TriageClientState
  batch?: BatchProgress | undefined
  onStart: (limits: { maxMessages: number; maxJevCalls: number }) => void
  onContinue: () => void
  onSkipFailed: () => void
  onResetCampaign: () => void
  onResume: () => void
  onRead: () => void
  onStop: () => void
  onRestart: () => void
  onForget: () => void
}>

const activeStatuses = new Set<TriageRunSnapshot['status']>(['queued', 'running', 'stopping'])
const jevInputUsdPerMillion = 0.042
const jevPriceSource = 'https://typesafe.ai/blog/introducing-system-one-models-and-jev'

function estimatedUsd(inputTokens: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(
    (inputTokens * jevInputUsdPerMillion) / 1_000_000,
  )
}

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

function RunForm({
  worklistSize,
  disabled,
  onStart,
}: Pick<TriageRunControlProps, 'worklistSize' | 'onStart'> & Readonly<{ disabled: boolean }>) {
  const [maxMessages, setMaxMessages] = useState(Math.max(1, worklistSize))
  const [maxJevCalls, setMaxJevCalls] = useState(Math.max(1, worklistSize))
  if (worklistSize === 0) {
    return (
      <p className="triage-run__detail">Jev starts after a complete Inbox scan with messages.</p>
    )
  }
  const submit = (event: SyntheticEvent<HTMLFormElement, SubmitEvent>) => {
    event.preventDefault()
    onStart({ maxMessages, maxJevCalls })
  }
  return (
    <form className="triage-run__form" onSubmit={submit}>
      <p className="triage-run__detail">
        Start Jev voor de {worklistSize.toLocaleString('nl-NL')} gescande Inbox-berichten. De taak
        loopt in delen van maximaal 100 berichten. De Inbox blijft ongewijzigd.
      </p>
      <details className="triage-run__advanced">
        <summary>Geavanceerde grenzen</summary>
        <label>
          <span>Maximaal berichten</span>
          <input
            aria-label="Maximum messages"
            type="number"
            min={1}
            max={worklistSize}
            value={maxMessages}
            disabled={disabled}
            onChange={(event) => {
              setMaxMessages(Number(event.currentTarget.value))
            }}
          />
        </label>
        <label>
          <span>Maximaal Jev-aanroepen</span>
          <input
            aria-label="Maximum Jev calls"
            type="number"
            min={1}
            max={worklistSize}
            value={maxJevCalls}
            disabled={disabled}
            onChange={(event) => {
              setMaxJevCalls(Number(event.currentTarget.value))
            }}
          />
        </label>
      </details>
      <Button type="submit" disabled={disabled || worklistSize === 0}>
        Start Jev-triage
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
        Run <code>{run.runId}</code> · geschat {estimatedUsd(run.cost.inputTokens)} volgens het{' '}
        <a href={jevPriceSource} target="_blank" rel="noopener noreferrer">
          publieke TypeSafe-tarief
        </a>
        , geraadpleegd 28 september 2026. Werkelijke accountkosten kunnen afwijken.
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

function CampaignProgress({ batch }: Readonly<{ batch: BatchProgress }>) {
  const remaining = Math.max(0, batch.total - batch.processed)
  const failures = batch.readErrors + batch.otherErrors
  const handled = Math.max(0, batch.processed - failures)
  return (
    <div className="triage-run__campaign">
      <p className="triage-run__eyebrow">
        {batch.status === 'running'
          ? 'Bezig'
          : batch.status === 'completed'
            ? 'Voltooid'
            : 'Gepauzeerd'}
      </p>
      <h3>
        {batch.processed.toLocaleString('nl-NL')} van {batch.total.toLocaleString('nl-NL')}{' '}
        berichten bekeken
      </h3>
      <p className="triage-run__detail">
        {handled.toLocaleString('nl-NL')} afgehandeld
        {failures > 0 ? `, ${String(failures)} mislukt` : ''}. {remaining.toLocaleString('nl-NL')}{' '}
        nog niet bekeken.
      </p>
      <progress
        aria-label="Jev-triage voortgang"
        max={Math.max(1, batch.total)}
        value={batch.processed}
      />
      {batch.readErrors > 0 && (
        <div className="triage-run__issue" role="status">
          <strong>
            {batch.readErrors} bericht{batch.readErrors === 1 ? '' : 'en'} kon
            {batch.readErrors === 1 ? '' : 'den'} niet uit Spark worden gelezen.
          </strong>
          <p>
            Deze berichten zijn niet naar Jev gestuurd. Je kunt het lezen gericht opnieuw proberen
            of deze fouten overslaan en de rest verwerken.
          </p>
        </div>
      )}
      {batch.otherErrors > 0 && (
        <div className="triage-run__issue" role="status">
          <strong>
            {batch.otherErrors} andere fout{batch.otherErrors === 1 ? '' : 'en'} vragen controle.
          </strong>
          <p>
            Bekijk de opgeslagen run voordat je verdergaat. Een onzekere Jev-aanroep wordt niet
            opnieuw verstuurd.
          </p>
        </div>
      )}
      <dl className="triage-run__stats">
        <div>
          <dt>Nieuw geclassificeerd</dt>
          <dd>{batch.classified}</dd>
        </div>
        <div>
          <dt>Al actueel</dt>
          <dd>{batch.alreadyCurrent}</dd>
        </div>
        <div>
          <dt>Dubbel overgeslagen</dt>
          <dd>{batch.duplicate}</dd>
        </div>
        <div>
          <dt>Mislukt</dt>
          <dd>{failures}</dd>
        </div>
      </dl>
      <p className="triage-run__meta">
        {batch.calls} Jev-aanroepen · {batch.inputTokens.toLocaleString('nl-NL')} inputtokens.
        Geschat {estimatedUsd(batch.inputTokens)} volgens het{' '}
        <a href={jevPriceSource} target="_blank" rel="noopener noreferrer">
          publieke TypeSafe-tarief
        </a>
        , geraadpleegd 28 september 2026. Werkelijke accountkosten kunnen afwijken.
      </p>
    </div>
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
  | 'state'
  | 'batch'
  | 'onContinue'
  | 'onSkipFailed'
  | 'onResetCampaign'
  | 'onResume'
  | 'onRead'
  | 'onStop'
  | 'onForget'
>

function ReadbackButton({ onRead, busy }: Readonly<{ onRead: () => void; busy: boolean }>) {
  return (
    <div className="triage-run__actions">
      <Button variant="secondary" onClick={onRead} disabled={busy}>
        Lees run opnieuw
      </Button>
    </div>
  )
}

function SafetyAction({
  state,
  batch,
  onResume,
  onRead,
  onStop,
  onResetCampaign,
}: Pick<
  RunActionsProps,
  'state' | 'batch' | 'onResume' | 'onRead' | 'onStop' | 'onResetCampaign'
>) {
  const busy = isBusy(state)
  if (isUncertain(state)) {
    return (
      <div className="triage-run__actions">
        <Button onClick={onResume} disabled={busy}>
          Controleer dezelfde aanvraag
        </Button>
      </div>
    )
  }
  if (state.phase === 'absent' && batch) {
    return (
      <div className="triage-run__actions">
        <ReadbackButton onRead={onRead} busy={busy} />
        <Button variant="secondary" onClick={onResetCampaign}>
          Nieuwe triage voorbereiden
        </Button>
      </div>
    )
  }
  if (state.phase === 'absent' || state.phase === 'unavailable') {
    return <ReadbackButton onRead={onRead} busy={busy} />
  }
  if (isActive(state.run)) {
    return (
      <div className="triage-run__actions">
        <Button
          variant="secondary"
          onClick={onStop}
          disabled={busy || state.run?.status === 'stopping'}
        >
          Veilig stoppen
        </Button>
      </div>
    )
  }
  return null
}

function CampaignActions({
  batch,
  busy,
  onContinue,
  onSkipFailed,
}: Readonly<{
  batch: BatchProgress
  busy: boolean
  onContinue: () => void
  onSkipFailed: () => void
}>) {
  const remaining = batch.processed < batch.total
  const retry = batch.retryableReadErrors > 0
  return (
    <div className="triage-run__actions">
      {(retry || remaining) && batch.calls < batch.maxCalls && (
        <Button onClick={onContinue} disabled={busy}>
          {retry ? 'Probeer leesfout opnieuw en ga verder' : 'Ga verder met overige berichten'}
        </Button>
      )}
      {retry && remaining && batch.calls < batch.maxCalls && (
        <Button variant="secondary" onClick={onSkipFailed} disabled={busy}>
          Sla leesfout over en ga verder
        </Button>
      )}
    </div>
  )
}

function hasSafetyAction(state: TriageClientState) {
  return (
    isUncertain(state) || ['absent', 'unavailable'].includes(state.phase) || isActive(state.run)
  )
}

function canResetBlockedCampaign(state: TriageClientState, batch: BatchProgress | undefined) {
  return (
    Boolean(batch) &&
    state.phase === 'blocked' &&
    !isActive(state.run) &&
    state.blockedReason !== 'run_in_progress' &&
    state.blockedReason !== 'request_mismatch'
  )
}

function canContinueCampaign(state: TriageClientState, batch: BatchProgress | undefined) {
  if (!batch) return false
  const hasWork = batch.processed < batch.total || batch.retryableReadErrors > 0
  return (
    batch.status === 'paused' &&
    isSettledCampaignRun(state) &&
    batch.otherErrors === 0 &&
    batch.calls < batch.maxCalls &&
    hasWork
  )
}

function isSettledCampaignRun(state: TriageClientState) {
  return state.phase === 'run' && ['completed', 'partial'].includes(state.run?.status ?? '')
}

function canResetCampaign(state: TriageClientState, batch: BatchProgress | undefined) {
  if (!batch || state.phase !== 'run') return false
  const exhausted = batch.calls >= batch.maxCalls
  const done = batch.processed >= batch.total && batch.retryableReadErrors === 0
  const endedWithoutContinuation = ['stopped', 'failed', 'interrupted'].includes(
    state.run?.status ?? '',
  )
  return batch.status === 'completed' || exhausted || done || endedWithoutContinuation
}

function RunActions(props: RunActionsProps) {
  const { state, batch, onContinue, onSkipFailed, onResetCampaign, onResume, onRead, onStop } =
    props
  if (hasSafetyAction(state)) {
    return (
      <SafetyAction
        state={state}
        batch={batch}
        onResume={onResume}
        onRead={onRead}
        onStop={onStop}
        onResetCampaign={onResetCampaign}
      />
    )
  }
  if (batch && canContinueCampaign(state, batch)) {
    return (
      <CampaignActions
        batch={batch}
        busy={isBusy(state)}
        onContinue={onContinue}
        onSkipFailed={onSkipFailed}
      />
    )
  }
  if (canResetBlockedCampaign(state, batch)) {
    return (
      <div className="triage-run__actions">
        <Button variant="secondary" onClick={onResetCampaign}>
          Nieuwe triage voorbereiden
        </Button>
      </div>
    )
  }
  if (canResetCampaign(state, batch)) {
    return (
      <div className="triage-run__actions">
        <Button variant="secondary" onClick={onResetCampaign}>
          Nieuwe triage voorbereiden
        </Button>
      </div>
    )
  }
  return state.run ? <ReadbackButton onRead={onRead} busy={isBusy(state)} /> : null
}

function ModalBody(props: TriageRunControlProps) {
  const {
    worklistSize,
    state,
    batch,
    onStart,
    onContinue,
    onSkipFailed,
    onResetCampaign,
    onResume,
    onRead,
    onStop,
    onForget,
  } = props
  return (
    <div className="triage-run__body">
      {batch ? (
        <CampaignProgress batch={batch} />
      ) : (
        <>
          <EmptyRunHeading state={state} />
          {state.run && (
            <p className="triage-run__detail">
              Van deze eerdere run is het totale campagneresultaat niet beschikbaar. De opgeslagen
              run blijft hieronder leesbaar. Een nieuwe start gebruikt de volledige huidige Inbox;
              al actuele berichten worden overgeslagen.
            </p>
          )}
        </>
      )}
      <RunFeedback state={state} />
      <RunActions
        state={state}
        batch={batch}
        onContinue={onContinue}
        onSkipFailed={onSkipFailed}
        onResetCampaign={onResetCampaign}
        onResume={onResume}
        onRead={onRead}
        onStop={onStop}
        onForget={onForget}
      />
      {canStartNewRun(state) && !batch && (
        <RunForm
          key={worklistSize}
          worklistSize={worklistSize}
          disabled={isBusy(state)}
          onStart={onStart}
        />
      )}
      {state.run && (
        <details className="triage-run__results">
          <summary>Verbruik en technische details</summary>
          <RunEvidence run={state.run} />
        </details>
      )}
    </div>
  )
}

/** Compact workbench control; it never starts work except from a labelled button. */
export function TriageRunControl(props: TriageRunControlProps) {
  const { batch } = props
  const [open, setOpen] = useState(false)
  const dialogRef = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])
  const trigger = batch
    ? `Jev-triage · ${batch.processed.toLocaleString('nl-NL')}/${batch.total.toLocaleString('nl-NL')}`
    : 'Run Jev'
  return (
    <div className="triage-run-trigger">
      <Button
        variant="secondary"
        onClick={() => {
          setOpen(true)
        }}
      >
        {trigger}
      </Button>
      <dialog
        ref={dialogRef}
        className="triage-run"
        aria-label="Jev-triage voortgang"
        onClose={() => {
          setOpen(false)
        }}
        onClick={(event: MouseEvent<HTMLDialogElement>) => {
          if (event.target === dialogRef.current) setOpen(false)
        }}
      >
        <div className="triage-run__head">
          <h2>Jev-triage</h2>
          <button
            type="button"
            className="triage-run__close"
            aria-label="Sluit Jev-triage"
            onClick={() => {
              setOpen(false)
            }}
          >
            ×
          </button>
        </div>
        <ModalBody {...props} />
        <footer className="triage-run__footer">
          <Button
            variant="secondary"
            onClick={() => {
              setOpen(false)
            }}
          >
            Sluiten
          </Button>
        </footer>
      </dialog>
    </div>
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
