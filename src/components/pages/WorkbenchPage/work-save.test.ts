import { describe, expect, it } from 'vitest'
import { decideFollowUp, followUpWork, type FollowUpKind } from '../../../domain/follow-up'
import type { TargetObservation } from '../../../domain/mailbox-action'
import { dueInstant } from './useWorkSave'
import { storedView } from './work-save'

// Synthetic mail only: every address uses a reserved `.example` domain.
const studio = 'studio@mail.example'

const decide = (kind: FollowUpKind, dueAt: string | null = null) =>
  decideFollowUp({
    target: {
      copy: { mailboxId: studio, messageId: '11' },
      threadId: 't-11',
      latestMessageId: '11',
    },
    kind,
    dueAt,
    decidedBy: 'wesley',
    decidedAt: '2026-09-27T09:15:00.000Z',
  })

const at = (latestMessageId: string): TargetObservation => ({
  copy: { mailboxId: studio, messageId: '11' },
  observed: 'named',
  threadId: 't-11',
  latestMessageId,
  proven: true,
})

describe('storedView', () => {
  it('shows nothing where nobody saved a decision for this copy', () => {
    expect(storedView(undefined)).toBeNull()
    expect(storedView(followUpWork([], [at('11')]))).toBeNull()
  })

  it('reads back saved open work with who saved it and its date', () => {
    const view = storedView(
      followUpWork([decide('follow_up_later', '2026-10-02T12:00:00.000Z')], [at('11')]),
    )
    expect(view).toMatchObject({
      title: 'Follow up later',
      state: { label: 'Open work', tone: 'review' },
    })
    expect(view?.detail).toContain('Saved by wesley')
    expect(view?.detail).toContain('due ')
    expect(view?.detail).toContain('exact mailbox copy and version')
  })

  it('reads back handled in Spark as a claim, not a confirmed Done', () => {
    const view = storedView(followUpWork([decide('handled_in_spark')], [at('11')]))
    expect(view?.state.label).toBe('Your claim')
    expect(view?.detail).toContain('not a confirmed Done')
  })

  it('never carries a saved decision onto a newer version', () => {
    const view = storedView(followUpWork([decide('handled_in_spark')], [at('12')]))
    expect(view?.state).toEqual({ label: 'Out of date', tone: 'danger' })
    expect(view?.detail).toContain('A later message has reached this thread')
    expect(view?.detail).toContain('the work is open again')
  })

  it('says a saved decision is unchecked where the reading names no version', () => {
    const view = storedView(followUpWork([decide('reply_needed')], []))
    expect(view?.state.label).toBe('Version not checked')
    expect(view?.detail).toContain('unknown')
  })
})

describe('dueInstant', () => {
  it('owes a dated decision through the end of that local day', () => {
    const due = dueInstant('2026-10-02')
    expect(due).not.toBeNull()
    expect(new Date(due ?? '').getDate()).toBe(2)
    expect(new Date(due ?? '').getHours()).toBe(23)
  })

  it('reads an empty or malformed date as no date', () => {
    expect(dueInstant('')).toBeNull()
    expect(dueInstant('2 October')).toBeNull()
    expect(dueInstant('2026-13-45')).toBeNull()
  })
})
