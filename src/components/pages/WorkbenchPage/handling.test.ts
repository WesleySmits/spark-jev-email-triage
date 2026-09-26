import { describe, expect, it } from 'vitest'
import { handlingOutcomes } from '../../../domain/handling'
import {
  approveProposal,
  actionStanding,
  proposeMailboxAction,
  type ActionStanding,
  type TargetObservation,
} from '../../../domain/mailbox-action'
import {
  asOutcome,
  handlingNote,
  handlingOptions,
  handlingResult,
  handlingStatus,
  handlingTags,
  recordedDecision,
} from './handling'

const studio = 'studio@mail.example'

const proposal = proposeMailboxAction({
  kind: 'markAsDone',
  scope: 'spark-message-id',
  targets: [
    { copy: { mailboxId: studio, messageId: '11' }, threadId: 't-11', latestMessageId: '11' },
  ],
  basis: null,
  proposedAt: '2026-09-26T09:15:00.000Z',
})

const read = (latestMessageId: string): TargetObservation => ({
  copy: { mailboxId: studio, messageId: '11' },
  observed: 'named',
  threadId: 't-11',
  latestMessageId,
  proven: true,
})

const approval = approveProposal(proposal, {
  approvedBy: 'you, at this computer',
  approvedAt: '2026-09-26T09:16:00.000Z',
})

const proposed = actionStanding(proposal, null, [read('11')])
const approved = actionStanding(proposal, approval, [read('11')])
const lapsed: ActionStanding = actionStanding(proposal, approval, [read('12')])

describe('handlingOptions', () => {
  it('offers every outcome the domain names, with what each one changes', () => {
    const options = handlingOptions('available', true)
    expect(options.map((option) => option.value)).toEqual([...handlingOutcomes])
    expect(options[0]?.effect).toContain('guarded Spark Done')
    for (const option of options.slice(1)) {
      expect(option.effect).not.toContain('Spark Done')
      expect(option.disabled).toBe(false)
    }
  })

  it('refuses Handle now in words where no action path is connected', () => {
    const [handleNow, ...local] = handlingOptions('not_connected', true)
    expect(handleNow?.disabled).toBe(true)
    expect(handleNow?.effect).toContain('no Spark action path is connected')
    // The outcomes that never reach a provider are unaffected by that.
    expect(local.every((option) => option.disabled === false)).toBe(true)
  })

  it('refuses every outcome where the reading names no exact version', () => {
    expect(handlingOptions('available', false).every((option) => option.disabled)).toBe(true)
    expect(handlingResult(false).title).toBe('Nothing to decide against')
  })
})

describe('handlingNote', () => {
  it('names the message ID Spark acts on and the copies that share it', () => {
    const note = handlingNote('11')
    expect(note).toContain('message ID 11')
    expect(note).toContain('another copy carrying it may change too')
    expect(note).toContain('Nothing is stored yet')
    // No link into Spark is offered, because none was ever proved.
    expect(note).toContain('no link that opens this exact message in Spark has been proven')
  })

  it('says why nothing can be recorded when no version is named', () => {
    expect(handlingNote(undefined)).toContain('does not name an exact version')
  })
})

describe('recordedDecision', () => {
  it('keeps a local outcome local, and says nothing was stored', () => {
    const view = recordedDecision('reply_needed', null, null)
    expect(view).toMatchObject({ title: 'Reply needed', locked: false })
    expect(view.state.label).toBe('Local work status')
    expect(view.detail).toContain('mail stays in your Spark Inbox')
    expect(view.detail).toContain('nothing was stored')
  })

  it('never reads as done while Spark has only been asked', () => {
    expect(recordedDecision('handle_now', proposed, null)).toMatchObject({
      state: { label: 'Proposed, not run' },
      locked: false,
    })
    expect(recordedDecision('handle_now', approved, null).state.label).toBe('Approved, not run')
    expect(recordedDecision('handle_now', approved, null).detail).toContain('nothing has been sent')
  })

  it('leaves a lapsed proposal as open work that can be decided again', () => {
    const view = recordedDecision('handle_now', lapsed, null)
    expect(view.state).toEqual({ label: 'Out of date', tone: 'danger' })
    expect(view.detail).toContain('The work stays open')
    expect(view.locked).toBe(false)
  })

  it('shows only a confirmed readback as done, and locks that attempt', () => {
    const view = recordedDecision('handle_now', approved, { status: 'confirmed' })
    expect(view.state).toEqual({ label: 'Done confirmed', tone: 'done' })
    expect(view.detail).toContain('read back in Archive and absent from Inbox')
    expect(view.locked).toBe(true)
  })

  it('keeps an uncertain attempt open, locked and never retried on its own', () => {
    const view = recordedDecision('handle_now', approved, { status: 'uncertain' })
    expect(view.state).toEqual({ label: 'Still open, unresolved', tone: 'danger' })
    expect(view.detail).toContain('may have changed this message')
    expect(view.detail).toContain('no automatic retry is allowed')
    expect(view.locked).toBe(true)
  })

  it('keeps blocked work open and says which guard refused it', () => {
    const view = recordedDecision('handle_now', approved, {
      status: 'blocked',
      reason: 'disabled',
    })
    expect(view.detail).toContain('switched off on this computer')
    expect(view.detail).toContain('the work stays open')
    // Nothing was sent, so this decision may still be taken back.
    expect(view.locked).toBe(false)
  })
})

describe('handlingTags', () => {
  it('says Spark is unchanged only while nothing was sent to it', () => {
    expect(handlingTags(null)).toContain('Spark unchanged')
    expect(handlingTags(recordedDecision('read_only', null, null))).toContain('Spark unchanged')
    expect(handlingTags(recordedDecision('handle_now', proposed, null))).toContain(
      'Spark unchanged so far',
    )
  })

  it('never claims Spark is unchanged after an attempt that did not settle', () => {
    const tags = handlingTags(recordedDecision('handle_now', approved, { status: 'uncertain' }))
    expect(tags).toEqual(['Decision', 'Spark may have changed', 'Work still open'])
    expect(tags.join(' ')).not.toContain('unchanged')
  })

  it('claims a confirmed Done only where a readback proved it', () => {
    expect(handlingTags(recordedDecision('handle_now', approved, { status: 'confirmed' }))).toEqual(
      ['Decision', 'Spark Done confirmed by readback'],
    )
    expect(
      handlingTags(
        recordedDecision('handle_now', approved, { status: 'blocked', reason: 'replay' }),
      ),
    ).toContain('No Spark action sent')
  })
})

describe('handlingStatus', () => {
  it('says nothing before anyone decided', () => {
    expect(handlingStatus(null, false)).toBe('')
  })

  it('says a decision was taken back, and that nothing ran', () => {
    expect(handlingStatus(null, true)).toContain('Nothing is recorded, proposed, approved')
  })

  it('announces where a recorded decision stands', () => {
    const view = recordedDecision('handle_now', approved, { status: 'uncertain' })
    expect(handlingStatus(view, false)).toContain('Still open, unresolved')
  })
})

describe('asOutcome', () => {
  it('reads only the outcomes the domain names', () => {
    expect(asOutcome('read_only')).toBe('read_only')
    expect(asOutcome('archive')).toBeNull()
  })
})
