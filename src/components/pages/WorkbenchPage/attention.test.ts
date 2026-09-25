import { describe, expect, it } from 'vitest'
import type { RowReview } from '../../../app/desk-review'
import type { Attention } from '../../../domain/attention'
import type {
  ClassificationLabels,
  StoredClassification,
} from '../../../domain/stored-classification'
import {
  attentionReason,
  groupByAttention,
  nextGroupStart,
  orderByAttention,
  rowAttention,
} from './attention'
import type { WorkbenchMessage } from './workbench'

// Fictional rows and judgments. What places a row is decided in
// `domain/attention.test.ts`; this file covers the worklist built from it.
const labels: ClassificationLabels = {
  category: 'personal',
  priority: 'normal',
  confidence: 0.91,
  priorityUncertain: false,
  review: 'auto_accepted',
  reviewPriority: 'normal',
  grounds: { state: 'recorded', reasons: [], suspicionSignals: [] },
}

const judged = {
  subject: {
    copy: { mailboxId: 'one@mail.example', messageId: '11' },
    threadId: 't-11',
    latestMessageId: '11',
    rubric: 'email-triage.v2',
    classifierVersion: 'jev-1.13.0',
  },
  judgedAt: '2026-09-22T09:15:00.000Z',
} as const

const unverified = (change: Partial<ClassificationLabels> = {}): StoredClassification => ({
  ...judged,
  state: 'unverified',
  labels: { ...labels, ...change },
})

const decision = { decision: 'corrected', reviewer: 'wesley', reviewedAt: judged.judgedAt } as const

const reviewOf = (labels: RowReview['labels']): RowReview => ({
  decidedBy: 'reviewer',
  decision: 'corrected',
  labels,
  fields: {
    ...(labels.category !== undefined && { category: decision }),
    ...(labels.priority !== undefined && { priority: decision }),
  },
  reviewer: 'wesley',
  reviewedAt: judged.judgedAt,
})

const row = (id: string): WorkbenchMessage => ({
  id,
  workflow: 'inbox',
  mailbox: 'one@mail.example',
  sender: `Sender ${id}`,
  time: '09:42',
  subject: `Subject ${id}`,
  snippet: '',
  account: { marker: 'studio', label: 'one@mail.example' },
  status: { label: 'Not triaged', tone: 'neutral' },
})

describe('rowAttention', () => {
  it('groups a row the reading listed nothing about as not triaged', () => {
    expect(rowAttention(undefined, undefined)).toEqual({ state: 'unclassified', cause: 'none' })
  })

  it('places a listed row by its judgment and any review of it', () => {
    expect(rowAttention(unverified({ priority: 'urgent' }), undefined)).toMatchObject({
      state: 'high_priority',
    })
    expect(
      rowAttention(unverified({ priority: 'urgent' }), reviewOf({ category: 'promotion' })),
    ).toMatchObject({ state: 'informational', categoryBy: 'reviewer' })
  })
})

describe('attentionReason', () => {
  it('names the labels that placed the row and who decided each', () => {
    expect(attentionReason(rowAttention(unverified({ priority: 'urgent' }), undefined))).toBe(
      "Personal, the model's; priority Urgent, the model's.",
    )
  })

  it('keeps a person’s decision and the model’s advice apart in words', () => {
    const reason = attentionReason(
      rowAttention(
        unverified({ category: 'notification', priority: 'low' }),
        reviewOf({ category: 'personal' }),
      ),
    )
    expect(reason).toBe(
      "Personal, decided by a person; priority Low, the model's. Model advice: Notification, Low.",
    )
  })

  it('says a person was asked, how soon, and what the model advised', () => {
    const asked = unverified({
      category: 'other',
      priority: 'low',
      review: 'needs_review',
      reviewPriority: 'elevated',
      priorityUncertain: true,
      grounds: {
        state: 'recorded',
        reasons: ['suspicious'],
        suspicionSignals: ['credential_request'],
      },
    })
    expect(attentionReason(rowAttention(asked, undefined))).toBe(
      'Policy asked for a person, sooner. No person has reviewed it. Possible scam or phishing, whatever it is filed as. Model advice: Other, Low. The model was not sure of its priority.',
    )
  })

  it('keeps the warning after a review and drops the uncertainty once a person set the priority', () => {
    const asked = unverified({
      category: 'other',
      priority: 'low',
      review: 'needs_review',
      priorityUncertain: true,
      grounds: { state: 'recorded', reasons: ['suspicious'], suspicionSignals: [] },
    })
    expect(attentionReason(rowAttention(asked, reviewOf({ priority: 'normal' })))).toBe(
      "Other, the model's; priority Normal, decided by a person. Model advice: Other, Low. Possible scam or phishing, whatever it is filed as.",
    )
  })

  it('says why an unjudged row places nothing, by its cause', () => {
    expect(attentionReason({ state: 'unclassified', cause: 'stale' })).toMatch(/^Triage outdated\./)
    expect(attentionReason({ state: 'unclassified', cause: 'provider_failure' })).toMatch(
      /^Triage failed\./,
    )
    expect(attentionReason({ state: 'unclassified', cause: 'unavailable' })).toMatch(
      /^Triage unreadable\./,
    )
    expect(attentionReason({ state: 'unclassified', cause: 'none' })).toMatch(/^Not triaged\./)
  })
})

describe('worklist order and groups', () => {
  const attention: Record<string, Attention> = {
    a: { state: 'unclassified', cause: 'none' },
    b: rowAttention(unverified({ category: 'newsletter' }), undefined),
    c: rowAttention(unverified({ priority: 'urgent' }), undefined),
    d: rowAttention(unverified({ review: 'needs_review' }), undefined),
    e: rowAttention(unverified({ priority: 'high' }), undefined),
  }
  const of = (id: string) => attention[id] ?? { state: 'unclassified', cause: 'none' }
  const rows = ['a', 'b', 'c', 'd', 'e'].map(row)
  const ordered = orderByAttention(rows, of)

  it('orders rows by attention and keeps the given order within a group', () => {
    expect(ordered.map(({ id }) => id)).toEqual(['d', 'c', 'e', 'a', 'b'])
  })

  const view = 'unread messages'

  it('groups every state in order, with counts of what was loaded', () => {
    const groups = groupByAttention(ordered, of, { filtered: false, view })
    expect(groups.map(({ title, note, messages }) => [title, note, messages.length])).toEqual([
      ['Needs review', '1 of 5 loaded', 1],
      ['High priority', '2 of 5 loaded', 2],
      ['Attention', '0 of 5 loaded', 0],
      ['Not triaged', '1 of 5 loaded', 1],
      ['Informational', '1 of 5 loaded', 1],
    ])
    expect(
      groupByAttention(ordered, of, {
        coverage: { result: 'incomplete' },
        filtered: false,
        view,
      })[0]?.note,
    ).toBe('1 of 5 loaded')
  })

  it('counts every message of the view only where the app proved the reading complete', () => {
    const scope = { coverage: { result: 'complete' }, filtered: false, view } as const
    expect(groupByAttention(ordered, of, scope)[0]?.note).toBe('1 of 5 unread messages')
  })

  it('counts what a filter kept, whatever the reading proved', () => {
    const scope = { coverage: { result: 'complete' }, filtered: true, view } as const
    expect(groupByAttention(ordered, of, scope)[0]?.note).toBe('1 of 5 in this filter')
  })

  it('steps to the first row of the next group with rows, and stays at the end', () => {
    expect(nextGroupStart(ordered, 'd', of)).toBe('c')
    expect(nextGroupStart(ordered, 'c', of)).toBe('a')
    expect(nextGroupStart(ordered, 'e', of)).toBe('a')
    expect(nextGroupStart(ordered, 'b', of)).toBeUndefined()
    expect(nextGroupStart(ordered, undefined, of)).toBe('d')
    expect(nextGroupStart([], undefined, of)).toBeUndefined()
  })
})
