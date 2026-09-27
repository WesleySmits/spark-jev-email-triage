/**
 * What the recorded work list says, and what it refuses to say.
 *
 * `follow-up.test.ts` owns where the work on one copy stands; nothing here
 * restates it. What is tested here is the list: how a copy's Inbox standing
 * is proved rather than assumed, which group an item lands in, what is
 * reported as a conflict instead of being resolved quietly, and that every
 * count is of this application's own records.
 */
import { describe, expect, it } from 'vitest'
import { decideFollowUp, type FollowUpDecision, type FollowUpKind } from './follow-up'
import type { TargetObservation } from './mailbox-action'
import {
  canReopen,
  inboxStanding,
  openWorkItem,
  openWorkList,
  openWorkTally,
  owedCount,
  sortOpenWorkItems,
  type InboxEvidence,
  type WorkCopyRecord,
} from './open-work'

const studio = 'studio@mail.example'
const alias = 'alias@mail.example'

const now = '2026-09-27T09:00:00.000Z'
const past = '2026-09-20T09:00:00.000Z'
const future = '2026-10-04T09:00:00.000Z'

/** Fictional mail. The same provider id is listed in two mailboxes. */
const target = (mailboxId: string, latestMessageId = '11') => ({
  copy: { mailboxId, messageId: '11' },
  threadId: 't-11',
  latestMessageId,
})

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
    decidedAt: options.decidedAt ?? '2026-09-19T09:15:00.000Z',
  })

/** What a reading that names one version of one copy observed about it. */
const observed = (mailboxId: string, latestMessageId: string): TargetObservation => ({
  copy: { mailboxId, messageId: '11' },
  observed: 'named',
  threadId: 't-11',
  latestMessageId,
  proven: true,
})

const listed: InboxEvidence = { reach: 'listed', view: 'unread' }

/** `null` is a reading that named no version, which `undefined` cannot say here. */
const record = (
  decisions: readonly FollowUpDecision[],
  evidence: InboxEvidence = listed,
  observation: TargetObservation | null = observed(studio, '11'),
  mailboxId = studio,
): WorkCopyRecord => ({
  copy: { mailboxId, messageId: '11' },
  decisions,
  evidence,
  ...(observation !== null && { observation }),
})

const item = (
  decisions: readonly FollowUpDecision[],
  evidence?: InboxEvidence,
  observation: TargetObservation | null = observed(studio, '11'),
) => {
  const built = openWorkItem(record(decisions, evidence, observation), now)
  if (built === null) throw new Error('expected an item for a copy with decisions')
  return built
}

describe('inboxStanding', () => {
  it('proves a copy is in the Inbox only from a reading that listed it', () => {
    expect(inboxStanding({ reach: 'listed', view: 'read' })).toEqual({
      status: 'in_inbox',
      view: 'read',
    })
  })

  it('proves a copy is out of the Inbox only from a complete reading of its mailbox', () => {
    expect(inboxStanding({ reach: 'read_completely' })).toEqual({ status: 'not_in_inbox' })
  })

  it('says unknown, never Done, where a bound, a failure or absence stopped it', () => {
    expect(inboxStanding({ reach: 'bounded' })).toEqual({
      status: 'unknown',
      reason: 'bounded_reading',
    })
    expect(inboxStanding({ reach: 'unreadable' })).toEqual({
      status: 'unknown',
      reason: 'mailbox_unreadable',
    })
    expect(inboxStanding({ reach: 'absent' })).toEqual({
      status: 'unknown',
      reason: 'mailbox_absent',
    })
  })
})

describe('openWorkItem', () => {
  it('holds nothing for a copy the record names no decision for', () => {
    expect(openWorkItem(record([]), now)).toBeNull()
  })

  it('groups work owed by a date still to come as open, with no conflict', () => {
    const open = item([decide('follow_up_later', { dueAt: future })])
    expect(open).toMatchObject({ group: 'open', dueAt: future, conflicts: [] })
    expect(open.work.state).toBe('open')
    expect(open.inbox).toEqual({ status: 'in_inbox', view: 'unread' })
  })

  it('groups work owed past the date somebody named as overdue', () => {
    expect(item([decide('reply_needed', { dueAt: past })]).group).toBe('overdue')
  })

  it('keeps undated open work out of overdue', () => {
    expect(item([decide('reply_needed')]).group).toBe('open')
  })

  it('groups a closure as completed and never calls the claim confirmed', () => {
    const closed = item([decide('handled_in_spark')], { reach: 'read_completely' })
    expect(closed).toMatchObject({ group: 'completed', dueAt: null, conflicts: [] })
    expect(closed.work.state).toBe('handled')
  })

  it('reports a claimed closure whose copy is still listed as a conflict', () => {
    const closed = item([decide('handled_in_spark')])
    // The claim still stands as the latest decision; the disagreement is stated.
    expect(closed.group).toBe('completed')
    expect(closed.conflicts).toEqual(['handled_still_in_inbox'])
  })

  it('reopens work whose version the thread moved past, as drift rather than silently', () => {
    const lapsed = item([decide('handled_in_spark')], listed, observed(studio, '12'))
    expect(lapsed.work.state).toBe('lapsed')
    expect(lapsed.group).toBe('open')
    expect(lapsed.conflicts).toEqual(['version_drift'])
  })

  it('counts a lapsed follow-up as overdue by the date it carried', () => {
    const lapsed = item(
      [decide('follow_up_later', { dueAt: past })],
      listed,
      observed(studio, '12'),
    )
    expect(lapsed).toMatchObject({ group: 'overdue', dueAt: past })
    expect(lapsed.conflicts).toContain('version_drift')
  })

  it('says unknown where the reading names no version for the copy', () => {
    const unseen = item([decide('reply_needed')], { reach: 'bounded' }, null)
    expect(unseen.work.state).toBe('unobserved')
    expect(unseen.group).toBe('unknown')
    expect(unseen.conflicts).toEqual(['unverified'])
  })

  it('never reads a bounded reading as mail that left the Inbox', () => {
    const unsure = item([decide('reply_needed')], { reach: 'bounded' })
    expect(unsure.inbox).toEqual({ status: 'unknown', reason: 'bounded_reading' })
    expect(unsure.conflicts).toEqual(['unverified'])
    expect(unsure.group).toBe('open')
  })

  it('reports open work on a copy a complete reading proves has left the Inbox', () => {
    const gone = item([decide('reply_needed')], { reach: 'read_completely' })
    expect(gone.conflicts).toEqual(['left_inbox'])
    expect(gone.group).toBe('open')
  })

  it('keeps every decision as that copy’s history, latest first', () => {
    const reopened = decide('reopen')
    const closure = decide('handled_in_spark')
    const built = item([reopened, closure])
    expect(built.history).toEqual([reopened, closure])
    expect(built.work.state).toBe('open')
    expect(canReopen(built)).toBe(false)
    expect(canReopen(item([closure, reopened]))).toBe(true)
  })
})

describe('openWorkList', () => {
  const records: readonly WorkCopyRecord[] = [
    record([decide('handled_in_spark')], { reach: 'read_completely' }),
    record([decide('reply_needed')]),
    record([decide('follow_up_later', { dueAt: past })]),
    record([decide('reply_needed')], { reach: 'bounded' }, null),
  ]

  it('lists what is late first, then owed, then unverified, then closed', () => {
    expect(openWorkList(records, now).map((entry) => entry.group)).toEqual([
      'overdue',
      'open',
      'unknown',
      'completed',
    ])
  })

  it('orders work owed by the soonest date, with undated work after it', () => {
    const dated = [
      record([decide('reply_needed')]),
      record([decide('reply_needed', { dueAt: future })]),
    ]
    expect(openWorkList(dated, now).map((entry) => entry.dueAt)).toEqual([future, null])
  })

  it('restores priority order when an older page adds an earlier due date', () => {
    const first = openWorkList([record([decide('follow_up_later', { dueAt: future })])], now)
    const earlier = '2026-09-28T09:00:00.000Z'
    const older = openWorkList(
      [
        record(
          [decide('reply_needed', { mailboxId: alias, dueAt: earlier })],
          listed,
          observed(alias, '11'),
          alias,
        ),
      ],
      now,
    )
    expect(sortOpenWorkItems([...first, ...older]).map(({ dueAt }) => dueAt)).toEqual([
      earlier,
      future,
    ])
  })

  it('keeps one delivery to an address and an alias as two items', () => {
    const copies = [
      record([decide('reply_needed')], listed, observed(studio, '11'), studio),
      record(
        [decide('handled_in_spark', { mailboxId: alias })],
        listed,
        observed(alias, '11'),
        alias,
      ),
    ]
    const list = openWorkList(copies, now)
    expect(list).toHaveLength(2)
    expect(new Set(list.map((entry) => entry.copyId)).size).toBe(2)
    expect(list.map((entry) => entry.group)).toEqual(['open', 'completed'])
  })

  it('leaves out a copy the record holds nothing for', () => {
    expect(openWorkList([record([])], now)).toEqual([])
  })
})

describe('openWorkTally', () => {
  it('counts this application’s own records, group by group', () => {
    const items = openWorkList(
      [
        record([decide('follow_up_later', { dueAt: past })]),
        record([decide('reply_needed')]),
        record([decide('reply_needed')], { reach: 'read_completely' }),
        record([decide('handled_in_spark')], { reach: 'read_completely' }),
        record([decide('reply_needed')], { reach: 'bounded' }, null),
      ],
      now,
    )
    const tally = openWorkTally(items)
    expect(tally).toEqual({
      copies: 5,
      open: 2,
      overdue: 1,
      completed: 1,
      unknown: 1,
      conflicts: 2,
    })
    expect(owedCount(tally)).toBe(3)
  })

  it('counts nothing where nothing was recorded', () => {
    expect(openWorkTally([])).toEqual({
      copies: 0,
      open: 0,
      overdue: 0,
      completed: 0,
      unknown: 0,
      conflicts: 0,
    })
  })
})
