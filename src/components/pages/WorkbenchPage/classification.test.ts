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

/** What a person decided about that judgment, as a reading projects it. */
const corrected = {
  decidedBy: 'reviewer',
  decision: 'corrected',
  labels: { category: 'suspicious', priority: 'urgent' },
  reviewer: 'wesley',
  reviewedAt: '2026-09-23T08:30:00.000Z',
} as const

const confirmed = {
  ...corrected,
  decision: 'confirmed',
  labels: { category: labels.category, priority: labels.priority },
} as const
const current: StoredClassification = { ...judged, state: 'current', labels }
const stale: StoredClassification = { ...judged, state: 'stale', reason: 'newer_message', labels }

describe('evidenceFor', () => {
  it('shows what the reading listed while no body read has answered it', () => {
    expect(evidenceFor(unverified, undefined)).toBe(unverified)
    expect(evidenceFor(undefined, undefined)).toBeUndefined()
  })

  it('shows nothing where the reading listed nothing, whatever a read proved', () => {
    // A proof answers a listing; it is never a listing of its own, so there
    // is nothing to show it against.
    expect(evidenceFor(undefined, current)).toBeUndefined()
    expect(evidenceFor(undefined, stale)).toBeUndefined()
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

  it('shows no proof for a row no reading listed, so none ever stands alone', () => {
    const body = readUnder('reading-1', 'm1', current)
    // No reading at all, as a caller that passes no judgments has: the body
    // may still carry what its thread proved, but nothing listed the row.
    expect(evidenceIn(undefined, 'm1', body).open).toBeUndefined()
    expect(evidenceIn(undefined, 'm1', body).of('m1')).toBeUndefined()
    // A reading that listed this row nothing is no different.
    const empty = { reading: 'reading-1', states: {} } as const
    expect(evidenceIn(empty, 'm1', body).open).toBeUndefined()
    expect(evidenceIn(empty, 'm1', body).of('m1')).toBeUndefined()
  })

  it('shows no proof over a listing the store already answered for itself', () => {
    const body = readUnder('reading-1', 'm2', current)
    // m2 is listed `none`: nothing was stored, so nothing can be promoted.
    expect(evidenceIn(listed, 'm2', body).open).toEqual({ state: 'none' })
  })
})

describe('evidenceIn, what a person decided', () => {
  const listed = {
    reading: 'reading-1',
    states: { m1: unverified, m2: { state: 'none' } },
    reviews: { m1: corrected },
  } as const

  const readUnder = (reading: string, id: string, review?: typeof corrected): BodyState =>
    settleBody(requestBody(idleBody, id, reading), 1, {
      ok: true,
      body: { id, text: 'Hello', classification: current, ...(review && { review }) },
    })

  it('shows what the reading projected, so a refresh keeps a saved review', () => {
    const evidence = evidenceIn(listed, 'm1', idleBody)

    expect(evidence.openReview).toBe(corrected)
    expect(evidence.reviewOf('m1')).toBe(corrected)
    // A row nobody reviewed carries none, which is not an error.
    expect(evidence.reviewOf('m2')).toBeUndefined()
  })

  it('lets the body read of the open row answer with the store as it is now', () => {
    // Saved after the reading listed the row: the body read found it.
    const later = evidenceIn(
      { ...listed, reviews: {} },
      'm1',
      readUnder('reading-1', 'm1', corrected),
    )
    expect(later.openReview).toBe(corrected)

    // And a read that found none leaves the row with none, rather than
    // showing a decision the store no longer applies to that row.
    const gone = evidenceIn(listed, 'm1', readUnder('reading-1', 'm1'))
    expect(gone.openReview).toBeUndefined()
  })

  it('keeps what the reading itself said where no body read has answered it', () => {
    // A read under an earlier reading no longer answers this one.
    const outlived = evidenceIn(
      { ...listed, reading: 'reading-2' },
      'm1',
      readUnder('reading-1', 'm1'),
    )
    expect(outlived.openReview).toBe(corrected)
    expect(evidenceIn(listed, 'm1', { status: 'stale' }).openReview).toBe(corrected)
  })

  it('has nothing to show without a reading, an open row or any reviews', () => {
    expect(evidenceIn(undefined, 'm1', idleBody).openReview).toBeUndefined()
    expect(evidenceIn(listed, undefined, idleBody).openReview).toBeUndefined()
    const none = { reading: 'reading-1', states: { m1: unverified } } as const
    expect(evidenceIn(none, 'm1', idleBody).openReview).toBeUndefined()
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

describe('classificationView, once a person has reviewed', () => {
  it("shows the corrected category and keeps the model's suggestion beside it", () => {
    const facts = classificationView(current, corrected).facts

    expect(facts[0]).toEqual({
      term: 'Category',
      value: 'Suspicious',
      note: 'Chosen by a person. The model suggested Personal.',
    })
    expect(facts[1]).toMatchObject({ term: 'Priority', value: 'Urgent' })
  })

  it("shows a confirmation as the model's own labels, decided by a person", () => {
    const facts = classificationView(current, confirmed).facts

    expect(facts[0]).toEqual({
      term: 'Category',
      value: 'Personal',
      note: "A person confirmed the model's suggestion, Personal.",
    })
  })

  it('names who decided and when, and says it changed no mail', () => {
    const fact = classificationView(current, corrected).facts[2]

    expect(fact?.value).toBe('Corrected by a person')
    expect(fact?.note).toMatch(/^By wesley on /)
    expect(fact?.note).toMatch(/Labels only: your mail is unchanged\.$/)
    expect(classificationView(current, confirmed).facts[2]?.value).toBe('Confirmed by a person')
  })

  it("no longer offers the model's own review need, or its priority doubt", () => {
    const unsure = { ...labels, priorityUncertain: true, review: 'needs_review' } as const
    const facts = classificationView({ ...current, labels: unsure }, corrected).facts

    expect(JSON.stringify(facts)).not.toContain('Needs a person')
    expect(JSON.stringify(facts)).not.toContain('No person has reviewed this')
    // The person chose the priority too, so the model's doubt is spent.
    expect(facts[1]).toEqual({ term: 'Priority', value: 'Urgent' })
  })

  it('leaves the state beside the labels alone: reviewing makes nothing current', () => {
    expect(classificationView(stale, corrected).state).toEqual({
      label: 'Triage outdated',
      tone: 'review',
    })
    expect(classificationView(stale, corrected).detail).toMatch(/newer message/)
  })
})

describe('rowState', () => {
  it('shows the category a person decided, so a corrected row reads as corrected', () => {
    expect(rowState(current, corrected)).toEqual({
      status: { label: 'Triage current', tone: 'done' },
      category: 'Suspicious',
    })
    expect(rowState(current, confirmed).category).toBe('Personal')
    // A review decides labels, never the state the badge names.
    expect(rowState(stale, corrected).status).toEqual({ label: 'Triage outdated', tone: 'review' })
  })

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
