/**
 * The Open work tab's words over a real reading and a real record shape:
 * what each recorded copy is measured against, how it is counted, and what
 * the tab says when it holds nothing. `domain/open-work.test.ts` owns the
 * placement rules; nothing here restates them beyond what the words depend on.
 */
import { describe, expect, it } from 'vitest'
import type { RecordedWork } from '../../../app/open-work'
import { decideFollowUp, type FollowUpKind } from '../../../domain/follow-up'
import type { StoredClassification } from '../../../domain/stored-classification'
import type { ListedEvidence } from './classification'
import {
  mailboxLabels,
  openWorkCount,
  openWorkEmpty,
  openWorkView,
  workRecordsIn,
  type WorkReading,
} from './work'
import type { WorkbenchMessage } from './workbench'

// Synthetic mail only: every address uses a reserved `.example` domain.
const studio = 'studio@mail.example'
const alias = 'alias@mail.example'

const now = '2026-09-27T12:00:00.000Z'

const decide = (
  kind: FollowUpKind,
  options: Readonly<{ mailboxId?: string; latestMessageId?: string; dueAt?: string }> = {},
) =>
  decideFollowUp({
    target: {
      copy: { mailboxId: options.mailboxId ?? studio, messageId: '11' },
      threadId: 't-11',
      latestMessageId: options.latestMessageId ?? '11',
    },
    kind,
    dueAt: options.dueAt ?? null,
    decidedBy: 'wesley',
    decidedAt: '2026-09-26T09:15:00.000Z',
  })

const row = (mailboxId: string, unread = true): WorkbenchMessage => ({
  id: JSON.stringify([mailboxId, '11']),
  messageId: '11',
  mailbox: mailboxId,
  workflow: 'inbox',
  sender: 'Studio planning',
  time: '09:15',
  subject: `Catalogue handover (${mailboxId})`,
  snippet: '',
  account: { marker: 'studio', label: mailboxId },
  status: { label: 'Not triaged', tone: 'neutral' },
  unread,
})

/** A stored judgment naming one version of the row's copy, as a reading lists it. */
const judged = (mailboxId: string, latestMessageId: string): StoredClassification => ({
  state: 'unverified',
  subject: {
    copy: { mailboxId, messageId: '11' },
    threadId: 't-11',
    latestMessageId,
    rubric: 'email-triage.v2',
    classifierVersion: 'jev-1.13.0',
  },
  judgedAt: '2026-09-26T09:00:00.000Z',
  labels: {
    category: 'personal',
    priority: 'high',
    confidence: 0.9,
    priorityUncertain: false,
    review: 'auto_accepted',
    reviewPriority: 'normal',
    grounds: { state: 'recorded', reasons: [], suspicionSignals: [] },
  },
})

const listed = (states: Record<string, StoredClassification>): ListedEvidence => ({
  reading: 'r-1',
  states,
})

type ReadyWork = Extract<RecordedWork, { status: 'ready' }>

const recorded = (...copies: [string, ReturnType<typeof decide>[]][]): ReadyWork => ({
  status: 'ready',
  bounded: false,
  readAt: now,
  copies: copies.map(([mailboxId, decisions]) => ({
    copy: { mailboxId, messageId: '11' },
    decisions,
  })),
})

const labels = { labelOf: mailboxLabels([{ id: studio, icon: 'inbox', label: 'Studio · work' }]) }

const readingOf = (
  messages: readonly WorkbenchMessage[],
  latest = '11',
  reach: WorkReading['reachOf'] = () => 'bounded',
): WorkReading => ({
  messages,
  classifications: listed(
    Object.fromEntries(messages.map((message) => [message.id, judged(message.mailbox, latest)])),
  ),
  reachOf: reach,
})

describe('workRecordsIn', () => {
  it('measures a listed copy against the version its stored judgment names', () => {
    const [record] = workRecordsIn(
      recorded([studio, [decide('reply_needed')]]).copies,
      readingOf([row(studio)]),
    )
    expect(record?.evidence).toEqual({ reach: 'listed', view: 'unread' })
    expect(record?.observation).toMatchObject({ observed: 'named', latestMessageId: '11' })
  })

  it('names no version and proves nothing for a copy the reading does not list', () => {
    const [record] = workRecordsIn(
      [{ copy: { mailboxId: studio, messageId: '11' }, decisions: [decide('reply_needed')] }],
      { messages: [] },
    )
    expect(record?.evidence).toEqual({ reach: 'bounded' })
    expect(record?.observation).toBeUndefined()
  })
})

describe('openWorkView', () => {
  it('counts open, overdue and completed work apart from any Inbox count', () => {
    const view = openWorkView(
      recorded(
        [studio, [decide('follow_up_later', { dueAt: '2026-09-20T12:00:00.000Z' })]],
        [alias, [decide('handled_in_spark', { mailboxId: alias })]],
      ),
      readingOf([row(studio), row(alias)]),
      labels,
      now,
    )
    expect(view.count).toBe('0 open · 1 overdue · 1 completed')
    expect(view.context).toContain('Not a Spark Inbox count')
    expect(openWorkCount(view)).toBe('1')
    expect(view.sections.map(({ title }) => title)).toEqual(['Overdue follow-up', 'Completed here'])
  })

  it('keeps a delivery to an address and an alias as two items, each by its mailbox', () => {
    const view = openWorkView(
      recorded(
        [studio, [decide('reply_needed')]],
        [alias, [decide('reply_needed', { mailboxId: alias })]],
      ),
      readingOf([row(studio), row(alias)]),
      labels,
      now,
    )
    const items = view.sections.flatMap(({ items: each }) => each)
    expect(items).toHaveLength(2)
    expect(items.map(({ source }) => source)).toEqual(['Studio · work', alias])
    expect(new Set(items.map(({ id }) => id)).size).toBe(2)
  })

  it('shows version drift as out of date with the work open, never as current', () => {
    const view = openWorkView(
      recorded([studio, [decide('handled_in_spark')]]),
      readingOf([row(studio)], '12'),
      labels,
      now,
    )
    const [item] = view.sections.flatMap(({ items }) => items)
    expect(view.tally).toMatchObject({ open: 1, completed: 0 })
    expect(item?.standing.label).toBe('Open')
    expect(item?.conflicts.join(' ')).toContain('Out of date')
    // The reopen a completed item offers is gone once the work is open again.
    expect(item?.reopen).toBeUndefined()
  })

  it('says a copy left the Inbox only where both views read its mailbox to the end', () => {
    const proven = openWorkView(
      recorded([studio, [decide('reply_needed')]]),
      { messages: [], reachOf: () => 'complete' },
      labels,
      now,
    )
    const [gone] = proven.sections.flatMap(({ items }) => items)
    expect(gone?.inbox).toBe('Not in Spark Inbox · both views read completely')
    expect(gone?.conflicts.join(' ')).toContain('No longer in the Spark Inbox')

    const bounded = openWorkView(
      recorded([studio, [decide('reply_needed')]]),
      { messages: [] },
      labels,
      now,
    )
    const [unsure] = bounded.sections.flatMap(({ items }) => items)
    expect(unsure?.inbox).toContain('Spark Inbox unknown')
    expect(unsure?.standing.label).toBe('Version not checked')
    expect(unsure?.title).toContain('not in this reading')
  })

  it('flags a claimed closure Spark still lists, and offers to reopen it', () => {
    const view = openWorkView(
      recorded([studio, [decide('handled_in_spark')]]),
      readingOf([row(studio)]),
      labels,
      now,
    )
    const [item] = view.sections.flatMap(({ items }) => items)
    expect(item?.standing.label).toBe('Completed · your claim')
    expect(item?.conflicts.join(' ')).toContain('Spark still lists it in the Inbox')
    expect(item?.reopen).toEqual({
      copy: { mailboxId: studio, messageId: '11' },
      threadId: 't-11',
      latestMessageId: '11',
    })
    expect(item?.rowId).toBe(row(studio).id)
  })

  it('says the list may be cut where the record was bounded', () => {
    const cut: ReadyWork = { ...recorded([studio, [decide('reply_needed')]]), bounded: true }
    expect(openWorkView(cut, readingOf([row(studio)]), labels, now).note).toContain(
      'most recently decided',
    )
  })
})

describe('openWorkEmpty', () => {
  it('says no open work was saved, distinct from an empty Inbox', () => {
    const empty = openWorkEmpty(openWorkView({ status: 'absent' }, { messages: [] }, labels, now))
    expect(empty?.title).toBe('No open work saved here')
    expect(empty?.description).toContain('says nothing about your Spark Inbox')
  })

  it('points to completed decisions when only those remain', () => {
    const view = openWorkView(
      recorded([studio, [decide('handled_in_spark')]]),
      readingOf([row(studio)]),
      labels,
      now,
    )
    expect(openWorkEmpty(view)?.description).toContain('Completed decisions are listed below')
  })

  it('never reads an unreadable record as empty', () => {
    const view = openWorkView({ status: 'unavailable' }, { messages: [] }, labels, now)
    expect(view.sections).toEqual([])
    expect(openWorkCount(view)).toBe('?')
    expect(openWorkEmpty(view)?.title).toBe('Open work could not be read')
  })

  it('shows no empty state while work is owed', () => {
    const view = openWorkView(
      recorded([studio, [decide('reply_needed')]]),
      readingOf([row(studio)]),
      labels,
      now,
    )
    expect(openWorkEmpty(view)).toBeNull()
  })
})
