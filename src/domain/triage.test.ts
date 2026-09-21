import { describe, expect, it } from 'vitest'
import type { z } from 'zod'
import { syntheticThreads } from './fixtures'
import { triageCategories } from './rubric'
import {
  currentTriageRubric,
  resolveTriage,
  triageCorrectionSchema,
  triageDecisionSchema,
} from './triage'

type DecisionInput = z.input<typeof triageDecisionSchema>
type Category = DecisionInput['category']

/** `top` gets `share`; the other categories split the remainder. */
const probabilities = (top: Category, share: number) => {
  const rest = (1 - share) / (triageCategories.length - 1)
  return Object.fromEntries(
    triageCategories.map((category) => [category, category === top ? share : rest]),
  ) as Record<Category, number>
}

const decision = (overrides: Partial<DecisionInput> = {}) =>
  triageDecisionSchema.parse({
    threadId: syntheticThreads.customerQuestion.id,
    rubric: currentTriageRubric,
    category: 'personal',
    priority: 'high',
    probabilities: probabilities('personal', 0.9),
    ...overrides,
  })

const correction = {
  threadId: syntheticThreads.customerQuestion.id,
  rubric: currentTriageRubric,
  category: 'purchase',
  priority: 'normal',
  correctedAt: '2026-01-05T10:00:00Z',
} as const

const issueMessages = (input: unknown) =>
  triageDecisionSchema.safeParse(input).error?.issues.map((issue) => issue.message) ?? []

describe('triageDecisionSchema', () => {
  it('pins the current rubric version', () => {
    expect(currentTriageRubric).toBe('email-triage.v2')
    expect(decision().rubric).toBe('email-triage.v2')
  })

  it.each([
    ['an unknown rubric version', { rubric: 'email-triage.v1' }, 'rubric'],
    ['a missing rubric', { rubric: undefined }, 'rubric'],
    ['a blank thread id', { threadId: '' }, 'threadId'],
    ['an unknown category', { category: 'spam' }, 'category'],
    ['an unknown priority', { priority: 'unknown' }, 'priority'],
  ])('rejects %s', (_, overrides, path) => {
    const result = triageDecisionSchema.safeParse({ ...decision(), ...overrides })

    expect(result.error?.issues.map((issue) => issue.path.join('.'))).toEqual([path])
  })

  it('accepts probabilities that sum to 1 within floating-point error', () => {
    const inexact = {
      ...probabilities('personal', 1),
      personal: 0.7,
      purchase: 0.1,
      notification: 0.1,
      newsletter: 0.1,
    }

    expect(Object.values(inexact).reduce((sum, value) => sum + value)).not.toBe(1)
    expect(decision({ probabilities: inexact }).probabilities).toEqual(inexact)
  })

  it.each([
    ['above 1', 1.2],
    ['below 0', -0.2],
    ['not a number', Number.NaN],
  ])('rejects a probability %s', (_, value) => {
    const input = {
      ...decision(),
      probabilities: { ...probabilities('personal', 0.9), other: value },
    }

    expect(triageDecisionSchema.safeParse(input).error?.issues[0]?.path).toEqual([
      'probabilities',
      'other',
    ])
  })

  it('rejects probabilities that do not sum to 1', () => {
    const input = {
      ...decision(),
      probabilities: { ...probabilities('personal', 0.9), other: 0 },
    }

    expect(issueMessages(input)).toEqual(['Category probabilities must sum to 1'])
  })

  it('rejects probabilities that omit a category', () => {
    const partial: Partial<Record<Category, number>> = probabilities('personal', 0.9)
    delete partial.other
    const result = triageDecisionSchema.safeParse({ ...decision(), probabilities: partial })

    expect(result.error?.issues[0]?.path).toEqual(['probabilities', 'other'])
  })

  it('rejects probabilities for an unknown category', () => {
    const input = {
      ...decision(),
      probabilities: { ...probabilities('personal', 0.9), spam: 0 },
    }

    expect(triageDecisionSchema.safeParse(input).error?.issues).toMatchObject([
      { code: 'unrecognized_keys', keys: ['spam'], path: ['probabilities'] },
    ])
  })

  it('rejects a category that is not the most probable', () => {
    const input = { ...decision(), category: 'purchase' }

    expect(issueMessages(input)).toEqual(['The decided category must have the highest probability'])
  })

  it('accepts either category of a tie', () => {
    const tie = { ...probabilities('personal', 1), personal: 0.5, purchase: 0.5 }

    expect(decision({ category: 'purchase', probabilities: tie }).category).toBe('purchase')
  })
})

describe('triageCorrectionSchema', () => {
  it('accepts a correction', () => {
    expect(triageCorrectionSchema.parse(correction)).toEqual(correction)
  })

  it.each([
    ['a missing correction time', { correctedAt: undefined }, 'correctedAt'],
    ['a correction time without offset', { correctedAt: '2026-01-05 10:00' }, 'correctedAt'],
    ['a missing rubric', { rubric: undefined }, 'rubric'],
    ['an unknown category', { category: 'spam' }, 'category'],
    ['a blank thread id', { threadId: ' ' }, 'threadId'],
  ])('rejects %s', (_, overrides, path) => {
    const result = triageCorrectionSchema.safeParse({ ...correction, ...overrides })

    expect(result.error?.issues.map((issue) => issue.path.join('.'))).toEqual([path])
  })
})

describe('resolveTriage', () => {
  it.each([
    [0.95, 'auto_accepted'],
    [0.8, 'auto_accepted'],
    [0.79, 'needs_review'],
  ])('with confidence %d, the model decision is %s', (share, review) => {
    const modelDecision = decision({ probabilities: probabilities('personal', share) })

    expect(resolveTriage(modelDecision, null)).toEqual({
      category: 'personal',
      priority: 'high',
      confidence: share,
      review,
    })
  })

  it('sends an ambiguous decision to review', () => {
    const ambiguous = decision({
      threadId: syntheticThreads.ambiguous.id,
      category: 'other',
      priority: 'normal',
      probabilities: probabilities('other', 0.35),
    })

    expect(resolveTriage(ambiguous, null).review).toBe('needs_review')
  })

  it('lets a human correction override the model decision', () => {
    expect(resolveTriage(decision(), triageCorrectionSchema.parse(correction))).toEqual({
      category: 'purchase',
      priority: 'normal',
      confidence: null,
      review: 'human_reviewed',
    })
  })

  it('records a confirmation of the model decision as human reviewed', () => {
    const confirmation = triageCorrectionSchema.parse({
      ...correction,
      category: 'personal',
      priority: 'high',
    })

    expect(resolveTriage(decision(), confirmation)).toMatchObject({
      category: 'personal',
      review: 'human_reviewed',
    })
  })

  it('rejects a correction for another thread', () => {
    const otherThread = triageCorrectionSchema.parse({
      ...correction,
      threadId: syntheticThreads.invoice.id,
    })

    expect(() => resolveTriage(decision(), otherThread)).toThrow(
      'Correction does not match the decision thread and rubric',
    )
  })
})
