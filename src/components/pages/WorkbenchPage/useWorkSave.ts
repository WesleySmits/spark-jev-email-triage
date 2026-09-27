import { useRef, useState } from 'react'
import type { WorkDecisionOutcome, WorkDecisionRequest } from '../../../app/open-work'
import type { FollowUpWork } from '../../../domain/follow-up'
import { followUpKindOf, type HandlingOutcome } from '../../../domain/handling'
import type { ActionTarget } from '../../../domain/mailbox-action'
import type { WorkSave } from './work-save'

/**
 * Where the reader saves work decisions, and what the record already held
 * for the open copy. Left out, nothing is saved and a decision is kept while
 * the message stays open.
 */
export type WorkSaving = Readonly<{
  onRecord: (request: WorkDecisionRequest) => Promise<WorkDecisionOutcome>
  /** Where the saved work on the open copy stands against this reading, if anyone decided. */
  stored: FollowUpWork | undefined
  /** Called once the store confirms a save, so the list can be read again. */
  onSaved?: (() => void) | undefined
}>

const saveOf = (outcome: WorkDecisionOutcome): WorkSave => {
  if (outcome.status === 'recorded') return { status: 'saved' }
  return outcome.status === 'unknown' ? { status: 'unconfirmed' } : { status: 'not_saved' }
}

/** Whether a request asks for the same decision as one whose answer was lost. */
const sameAsk = (a: WorkDecisionRequest, b: Omit<WorkDecisionRequest, 'requestId'>) =>
  JSON.stringify([a.kind, a.target, a.dueAt]) === JSON.stringify([b.kind, b.target, b.dueAt])

/**
 * The end of the chosen local day, as an instant, or `null` for no date. A
 * date typed as "2 October" is owed through that day where the person is.
 */
export function dueInstant(date: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null
  const end = new Date(`${date}T23:59:59.999`)
  return Number.isNaN(end.getTime()) ? null : end.toISOString()
}

/**
 * One save at a time to the local work record, with the store's answer.
 *
 * A save whose answer was lost keeps its Save id, and asking for the same
 * decision again sends that id once more: the store then answers with what
 * it did the first time instead of recording the decision twice.
 */
export function useWorkSave(work: WorkSaving | undefined) {
  const [saved, setSaved] = useState<WorkSave>({ status: work ? 'not_kept' : 'off' })
  const lost = useRef<WorkDecisionRequest | null>(null)
  const save = (outcome: HandlingOutcome, target: ActionTarget, dueAt: string | null) => {
    const kind = followUpKindOf(outcome)
    if (work === undefined || kind === null) {
      setSaved({ status: work === undefined ? 'off' : 'not_kept' })
      return
    }
    const ask = { kind, target, dueAt: kind === 'handled_in_spark' ? null : dueAt }
    const previous = lost.current
    const request = {
      ...ask,
      requestId:
        previous !== null && sameAsk(previous, ask) ? previous.requestId : crypto.randomUUID(),
    }
    setSaved({ status: 'saving' })
    void work
      .onRecord(request)
      .catch((): WorkDecisionOutcome => ({ status: 'unknown' }))
      .then((outcome) => {
        lost.current = outcome.status === 'unknown' ? request : null
        setSaved(saveOf(outcome))
        if (outcome.status === 'recorded') work.onSaved?.()
      })
  }
  return { saved, save } as const
}
