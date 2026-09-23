import { describe, expect, it } from 'vitest'
import type {
  ClassificationLabels,
  StoredClassification,
} from '../../../domain/stored-classification'
import { idleBody, requestBody, settleBody, type BodyState } from './body'
import { classificationView, evidenceFor, evidenceIn, rowState } from './classification'

// Fictional judgments, shaped as the domain states them. The applicability
// rules themselves belong to `domain/stored-classification.test.ts`; this
// file covers only which evidence the page shows and how it words it.
const labels: ClassificationLabels = {
  category: 'personal',
  priority: 'high',
  confidence: 0.91,
  priorityUncertain: false,
  review: 'auto_accepted',
  reviewPriority: 'normal',
}

const subject = {
  copy: { mailboxId: 'one@mail.example', messageId: '11' },
  threadId: 't-11',
  latestMessageId: '11',
  rubric: 'email-triage.v2',
  classifierVersion: 'jev-1.13.0',
} as const

const judgedAt = '2026-09-22T09:15:00.000Z'
const judged = { subject, judgedAt } as const

const unverified: StoredClassification = { ...judged, state: 'unverified', labels }
const current: StoredClassification = { ...judged, state: 'current', labels }
const stale: StoredClassification = { ...judged, state: 'stale', reason: 'newer_message', labels }

describe('evidenceFor', () => {
  it('shows what the reading listed while no body read has answered it', () => {
    expect(evidenceFor(unverified, undefined)).toBe(unverified)
    expect(evidenceFor(undefined, undefined)).toBeUndefined()
  })

  it('lets a body read of the same judgment prove it current or outdated', () => {
    expect(evidenceFor(unverified, current)).toBe(current)
    expect(evidenceFor(unverified, stale)).toBe(stale)
  })

  it('never promotes a judgment the store already contradicts', () => {
    const listed: StoredClassification = { ...judged, state: 'stale', reason: 'rubric', labels }
    expect(evidenceFor(listed, current)).toBe(listed)
    expect(evidenceFor({ state: 'none' }, current)).toEqual({ state: 'none' })
    expect(evidenceFor({ state: 'unavailable', reason: 'unreadable' }, current)).toMatchObject({
      state: 'unavailable',
    })
  })

  it('keeps the listing when the body read answers another judgment', () => {
    const otherCopy = { ...subject, copy: { mailboxId: 'two@mail.example', messageId: '11' } }
    expect(evidenceFor(unverified, { ...current, subject: otherCopy })).toBe(unverified)
    expect(evidenceFor(unverified, { ...current, judgedAt: '2026-09-20T09:15:00.000Z' })).toBe(
      unverified,
    )
    expect(
      evidenceFor(unverified, { ...current, subject: { ...subject, latestMessageId: '13' } }),
    ).toBe(unverified)
  })

  it('keeps the listing when the body read found no judgment or could not read one', () => {
    expect(evidenceFor(unverified, { state: 'none' })).toBe(unverified)
    expect(evidenceFor(unverified, { state: 'unavailable', reason: 'unreadable' })).toBe(unverified)
    expect(
      evidenceFor(unverified, { ...judged, state: 'provider_failure', errorCode: 'timeout' }),
    ).toBe(unverified)
  })
})

describe('evidenceIn', () => {
  const listed = {
    reading: 'reading-1',
    states: { m1: unverified, m2: { state: 'none' } },
  } as const

  /** A body of `id` that was read under `reading` and proved `proof`. */
  const readUnder = (reading: string, id: string, proof?: StoredClassification): BodyState =>
    settleBody(requestBody(idleBody, id, reading), 1, {
      ok: true,
      body: { id, text: 'Hello', ...(proof && { classification: proof }) },
    })

  it('lets the open row use what its own body read proved under this reading', () => {
    const evidence = evidenceIn(listed, 'm1', readUnder('reading-1', 'm1', current))
    expect(evidence.open).toBe(current)
    expect(evidence.of('m1')).toBe(current)
    // A row the reader never opened stays at what the store alone says.
    expect(evidence.of('m2')).toEqual({ state: 'none' })
  })

  it('keeps that proof while the same reading is rendered again', () => {
    const body = readUnder('reading-1', 'm1', current)
    expect(evidenceIn({ ...listed }, 'm1', body).open).toBe(current)
  })

  it('drops a proof a later reading has outlived, without asking for anything', () => {
    // The refresh listed the same judgment, unverified as ever: the store
    // holds no more than it did. The thread may have moved on since the body
    // was read, and nothing here read one again, so the proof is spent.
    const body = readUnder('reading-1', 'm1', current)
    const refreshed = evidenceIn({ ...listed, reading: 'reading-2' }, 'm1', body)
    expect(refreshed.open).toBe(unverified)
    expect(refreshed.of('m1')).toBe(unverified)
  })

  it('uses a proof again once the row is read anew under the current reading', () => {
    const body = readUnder('reading-2', 'm1', current)
    expect(evidenceIn({ ...listed, reading: 'reading-2' }, 'm1', body).open).toBe(current)
  })

  it('takes no proof from a body of another row, or one not there yet', () => {
    const other = readUnder('reading-1', 'm2', current)
    expect(evidenceIn(listed, 'm1', other).open).toBe(unverified)
    expect(evidenceIn(listed, 'm1', requestBody(idleBody, 'm1', 'reading-1')).open).toBe(unverified)
    expect(evidenceIn(listed, 'm1', { status: 'stale' }).open).toBe(unverified)
  })

  it('has nothing to show without a reading or an open row', () => {
    expect(evidenceIn(undefined, 'm1', idleBody).open).toBeUndefined()
    expect(evidenceIn(listed, undefined, idleBody).open).toBeUndefined()
  })
})

describe('classificationView', () => {
  it('names every state in words, with its own tone', () => {
    const named = (classification: StoredClassification) => classificationView(classification).state
    expect(named(current)).toEqual({ label: 'Triage current', tone: 'done' })
    expect(named(unverified)).toEqual({ label: 'Triage from earlier', tone: 'neutral' })
    expect(named(stale)).toEqual({ label: 'Triage outdated', tone: 'review' })
    expect(named({ ...judged, state: 'provider_failure', errorCode: null })).toEqual({
      label: 'Triage failed',
      tone: 'danger',
    })
    expect(named({ state: 'none' })).toEqual({ label: 'Not triaged', tone: 'neutral' })
    expect(named({ state: 'unavailable', reason: 'unreadable' })).toEqual({
      label: 'Triage unreadable',
      tone: 'neutral',
    })
  })

  it('says a judgment no read has proven is not confirmed, and when it was made', () => {
    const view = classificationView(unverified)
    expect(view.detail).toMatch(/not confirmed/)
    expect(view.judgedAt).toBe(judgedAt)
  })

  it('says why an outdated judgment no longer applies', () => {
    expect(classificationView({ ...stale, reason: 'rubric' }).detail).toMatch(/older set of triage/)
    expect(classificationView({ ...stale, reason: 'classifier' }).detail).toMatch(
      /older classifier/,
    )
    expect(classificationView(stale).detail).toMatch(/newer message/)
    expect(classificationView({ ...stale, reason: 'other_snapshot' }).detail).toMatch(/no longer/)
  })

  it('shows category, priority and review need, and never a probability', () => {
    expect(classificationView(current).facts).toEqual([
      { term: 'Category', value: 'Personal' },
      { term: 'Priority', value: 'High' },
      {
        term: 'Review',
        value: 'Accepted by the model',
        note: 'No person has reviewed this.',
      },
    ])
    expect(JSON.stringify(classificationView(current))).not.toContain('0.91')
  })

  it('marks an uncertain priority and a review need without acting on either', () => {
    const unsure = { ...labels, priorityUncertain: true, review: 'needs_review' } as const
    const facts = classificationView({ ...current, labels: unsure }).facts
    expect(facts[1]).toEqual({
      term: 'Priority',
      value: 'High',
      note: 'The model was not sure of this priority.',
    })
    expect(facts[2]).toMatchObject({ value: 'Needs a person' })
  })

  it('says an elevated review is only more urgent to look at', () => {
    const raised = { ...labels, reviewPriority: 'elevated' } as const
    expect(classificationView({ ...current, labels: raised }).facts[2]?.note).toBe(
      'No person has reviewed this. Marked as more urgent to look at.',
    )
  })

  it('carries no labels for a failure, absence or unreadable store', () => {
    const failure = classificationView({
      ...judged,
      state: 'provider_failure',
      errorCode: 'timeout',
    })
    expect(failure.facts).toEqual([])
    expect(failure.note).toBe('Reported: timeout')
    expect(
      classificationView({ ...judged, state: 'provider_failure', errorCode: null }).note,
    ).toBeUndefined()
    expect(classificationView({ state: 'none' })).toEqual({
      state: { label: 'Not triaged', tone: 'neutral' },
      detail: 'No triage run has stored anything for this message.',
      facts: [],
    })
    expect(
      classificationView({ state: 'unavailable', reason: 'unsupported_schema' }).detail,
    ).toMatch(/a version of this app that this one cannot read/)
  })
})

describe('rowState', () => {
  it('gives a row its state badge, and a category only where labels apply', () => {
    expect(rowState(current)).toEqual({
      status: { label: 'Triage current', tone: 'done' },
      category: 'Personal',
    })
    expect(rowState({ state: 'none' })).toEqual({
      status: { label: 'Not triaged', tone: 'neutral' },
      category: undefined,
    })
    expect(
      rowState({ ...judged, state: 'provider_failure', errorCode: null }).category,
    ).toBeUndefined()
  })
})
