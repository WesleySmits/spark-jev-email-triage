import { describe, expect, it } from 'vitest'
import {
  admitFollowUp,
  decideFollowUp,
  followUpKinds,
  followUpWork,
  parseFollowUpDecision,
  type FollowUpDecision,
  type FollowUpKind,
} from './follow-up'
import type { TargetObservation } from './mailbox-action'

const studio = 'studio@mail.example'
const alias = 'alias@mail.example'

/** Fictional mail. The same provider id is listed in two mailboxes. */
const target = (mailboxId: string, latestMessageId = '11') => ({
  copy: { mailboxId, messageId: '11' },
  threadId: 't-11',
  latestMessageId,
})

const decidedAt = '2026-09-27T09:15:00.000Z'

interface Options {
  mailboxId?: string
  latestMessageId?: string
  dueAt?: string | null
  decidedAt?: string
}

const decide = (kind: FollowUpKind, options: Options = {}): FollowUpDecision =>
  decideFollowUp({
    target: target(options.mailboxId ?? studio, options.latestMessageId),
    kind,
    dueAt: options.dueAt ?? null,
    decidedBy: 'wesley',
    decidedAt: options.decidedAt ?? decidedAt,
  })

/** What a reading that names one version of one copy observed about it. */
const observed = (mailboxId: string, latestMessageId: string): TargetObservation => ({
  copy: { mailboxId, messageId: '11' },
  observed: 'named',
  threadId: 't-11',
  latestMessageId,
  proven: false,
})

const here = [observed(studio, '11')]

describe('a follow-up decision', () => {
  it('names the four decisions about work owed, and not read only', () => {
    expect(followUpKinds).toEqual(['reply_needed', 'follow_up_later', 'handled_in_spark', 'reopen'])
  })

  it('keeps the version decided against and both instants in UTC', () => {
    const decision = decideFollowUp({
      target: target(studio),
      kind: 'follow_up_later',
      dueAt: '2026-10-02T11:00:00+02:00',
      decidedBy: 'wesley',
      decidedAt: '2026-09-27T11:15:00+02:00',
    })
    expect(decision.target).toEqual(target(studio))
    expect(decision.dueAt).toBe('2026-10-02T09:00:00.000Z')
    expect(decision.decidedAt).toBe('2026-09-27T09:15:00.000Z')
  })

  it('carries a due date only where work stays open', () => {
    const dueAt = '2026-10-02T09:00:00.000Z'
    expect(decide('reply_needed', { dueAt }).dueAt).toBe(dueAt)
    expect(decide('follow_up_later', { dueAt }).dueAt).toBe(dueAt)
    for (const kind of ['handled_in_spark', 'reopen'] as const) {
      expect(parseFollowUpDecision({ ...decide(kind), dueAt })).toBeNull()
    }
  })

  it('refuses input that names no version, decider or known decision', () => {
    const decision = decide('reply_needed')
    expect(parseFollowUpDecision({ ...decision, kind: 'read_only' })).toBeNull()
    expect(parseFollowUpDecision({ ...decision, decidedBy: ' ' })).toBeNull()
    expect(
      parseFollowUpDecision({ ...decision, target: { copy: decision.target.copy } }),
    ).toBeNull()
  })
})

describe('followUpWork', () => {
  it('says nothing about a copy nobody decided about', () => {
    expect(followUpWork([], here)).toEqual({ state: 'undecided' })
  })

  it('reads the newest decision about the version the reading holds', () => {
    const dueAt = '2026-10-02T09:00:00.000Z'
    const older = decide('reply_needed', { decidedAt: '2026-09-26T09:00:00.000Z' })
    const newer = decide('follow_up_later', { dueAt, decidedAt: '2026-09-27T09:00:00.000Z' })
    expect(followUpWork([older, newer], here)).toEqual({
      state: 'open',
      decision: newer,
      dueAt,
    })
    // The order a store hands them over decides nothing; the instants do.
    expect(followUpWork([newer, older], here)).toEqual({
      state: 'open',
      decision: newer,
      dueAt,
    })
  })

  it('reads a finished message as one person’s claim about that version', () => {
    const handled = decide('handled_in_spark')
    expect(followUpWork([handled], here)).toEqual({ state: 'handled', decision: handled })
  })

  it('opens the work again once a later message replaces the version decided', () => {
    const handled = decide('handled_in_spark')
    expect(followUpWork([handled], [observed(studio, '12')])).toEqual({
      state: 'lapsed',
      decision: handled,
      reason: 'newer_message',
    })
  })

  it('opens the work again when the copy belongs to another thread now', () => {
    const handled = decide('handled_in_spark')
    const moved: TargetObservation = {
      copy: { mailboxId: studio, messageId: '11' },
      observed: 'named',
      threadId: 't-12',
      latestMessageId: '11',
      proven: true,
    }
    expect(followUpWork([handled], [moved])).toEqual({
      state: 'lapsed',
      decision: handled,
      reason: 'other_thread',
    })
  })

  it('reads a reopened message as work owed on the version reopened', () => {
    const handled = decide('handled_in_spark', { decidedAt: '2026-09-26T09:00:00.000Z' })
    const reopened = decide('reopen', { decidedAt: '2026-09-27T09:00:00.000Z' })
    expect(followUpWork([handled, reopened], here)).toEqual({
      state: 'open',
      decision: reopened,
      dueAt: null,
    })
  })

  it('never lets one copy’s decision answer for another copy of the same id', () => {
    const handled = decide('handled_in_spark', { mailboxId: studio })
    expect(followUpWork([handled], [observed(alias, '11')])).toEqual({
      state: 'unobserved',
      decision: handled,
    })
    expect(followUpWork([], [observed(studio, '11')])).toEqual({ state: 'undecided' })
  })
})

describe('admitFollowUp', () => {
  it('records work owed whatever the record already says', () => {
    const handled = [decide('handled_in_spark')]
    for (const kind of ['reply_needed', 'follow_up_later', 'handled_in_spark'] as const) {
      expect(admitFollowUp(decide(kind), [])).toEqual({ status: 'admitted' })
      expect(admitFollowUp(decide(kind), handled)).toEqual({ status: 'admitted' })
    }
  })

  it('reopens only work the record says somebody closed', () => {
    const reopen = decide('reopen', { decidedAt: '2026-09-27T10:00:00.000Z' })
    const closed = decide('handled_in_spark', { decidedAt: '2026-09-26T09:00:00.000Z' })
    const open = decide('reply_needed', { decidedAt: '2026-09-26T10:00:00.000Z' })
    expect(admitFollowUp(reopen, [closed])).toEqual({ status: 'admitted' })
    // A closure the person has already answered is not a second one.
    expect(admitFollowUp(reopen, [closed, open])).toEqual({
      status: 'refused',
      reason: 'nothing_to_reopen',
    })
    expect(admitFollowUp(reopen, [])).toEqual({ status: 'refused', reason: 'nothing_to_reopen' })
  })

  it('reopens a closure the thread has moved past, which the record still holds', () => {
    const closed = decide('handled_in_spark', {
      latestMessageId: '10',
      decidedAt: '2026-09-26T09:00:00.000Z',
    })
    expect(admitFollowUp(decide('reopen'), [closed])).toEqual({ status: 'admitted' })
  })
})
