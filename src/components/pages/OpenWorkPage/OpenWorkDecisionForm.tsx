import { useState } from 'react'
import type { WorkDecisionRequest, WorkDecisionResult } from '../../../app/open-work'
import type { ActionTarget } from '../../../domain/mailbox-action'
import type { FollowUpKind } from '../../../domain/follow-up'
import { Button } from '../../atoms/Button/Button'

type Props = Readonly<{
  target: ActionTarget
  canReopen: boolean
  onRecord: (request: WorkDecisionRequest) => Promise<WorkDecisionResult>
}>

const choices: readonly Readonly<{ kind: FollowUpKind; label: string }>[] = [
  { kind: 'reply_needed', label: 'Reply needed' },
  { kind: 'follow_up_later', label: 'Follow up later' },
  { kind: 'handled_in_spark', label: 'I handled this in Spark' },
  { kind: 'reopen', label: 'Reopen' },
]

export function OpenWorkDecisionForm({ target, canReopen, onRecord }: Props) {
  const [kind, setKind] = useState<FollowUpKind>('reply_needed')
  const [due, setDue] = useState('')
  const [saving, setSaving] = useState(false)
  const [uncertain, setUncertain] = useState(false)
  const [status, setStatus] = useState('')
  const dueAt =
    (kind === 'reply_needed' || kind === 'follow_up_later') && due
      ? new Date(due).toISOString()
      : null
  const record = async () => {
    setSaving(true)
    const answer = await onRecord({ target, kind, dueAt, requestId: crypto.randomUUID() })
    setSaving(false)
    setUncertain(answer.status === 'unknown')
    setStatus(
      answer.status === 'recorded'
        ? 'Decision saved locally. Spark mailbox unchanged.'
        : answer.status === 'unknown'
          ? 'Save outcome unknown. Check the local record before another decision.'
          : `Decision not saved: ${answer.status === 'refused' ? answer.reason : answer.status}.`,
    )
  }
  return (
    <>
      <fieldset className="open-work__decision" disabled={saving || uncertain}>
        <legend>Record work for this version</legend>
        {choices
          .filter(({ kind }) => kind !== 'reopen' || canReopen)
          .map((choice) => (
            <label className="open-work__choice" key={choice.kind}>
              <input
                type="radio"
                name="open-work-kind"
                checked={kind === choice.kind}
                onChange={() => {
                  setKind(choice.kind)
                }}
              />{' '}
              {choice.label}
            </label>
          ))}
        {(kind === 'reply_needed' || kind === 'follow_up_later') && (
          <label className="open-work__due-field">
            Optional due date{' '}
            <input
              type="datetime-local"
              value={due}
              onChange={(event) => {
                setDue(event.target.value)
              }}
            />
          </label>
        )}
        <Button
          type="button"
          onClick={() => {
            void record()
          }}
        >
          {saving ? 'Saving…' : 'Save local decision'}
        </Button>
      </fieldset>
      <p className="open-work__save-status" role="status">
        {status}
      </p>
    </>
  )
}
