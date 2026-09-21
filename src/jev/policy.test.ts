import { describe, expect, it } from 'vitest'
import { threadSchema } from '../domain/email'
import { syntheticThreads } from '../domain/fixtures'
import { createJevClassifier, type JevClassification } from './classifier'
import { JevError } from './errors'
import { jevResponse, type ResponseOptions } from './fixtures'
import { resolveClassification, suspicionQuestions, type TriageOutcome } from './policy'
import { jevModel } from './questions'
import { triageResponseSchema } from './response'

const threadId = syntheticThreads.customerQuestion.id

function classified(
  options: ResponseOptions = {},
): Extract<JevClassification, { status: 'classified' }> {
  const { model, usage, answers } = triageResponseSchema.parse(jevResponse(options))
  return {
    status: 'classified',
    threadId,
    rubric: 'email-triage.v2',
    requestedModel: jevModel,
    model,
    usage: { inputTokens: usage.input_tokens, outputTokens: usage.output_tokens },
    answers,
  }
}

const resolve = (options: ResponseOptions = {}) => resolveClassification(classified(options))

const reviewRank = (outcome: TriageOutcome) =>
  (outcome.review === 'needs_review' ? 2 : 0) + (outcome.reviewPriority === 'elevated' ? 1 : 0)

describe('resolveClassification', () => {
  it('accepts the labels of a confident, unsuspicious classification', () => {
    const { confidence, ...labels } = resolve() as Extract<TriageOutcome, { status: 'classified' }>

    expect(confidence).toBeCloseTo(0.9, 10)
    expect(labels).toEqual({
      status: 'classified',
      threadId,
      category: 'personal',
      priority: 'high',
      priorityUncertain: false,
      review: 'auto_accepted',
      reviewPriority: 'normal',
      reasons: [],
      replyExpected: 'likely',
      deadline: 'unlikely',
      suspicionSignals: [],
    })
  })

  it('sends a provider failure to review without inventing labels', () => {
    const failure: JevClassification = {
      status: 'provider_failure',
      threadId,
      rubric: 'email-triage.v2',
      requestedModel: jevModel,
      failure: { code: 'unavailable', detail: null, httpStatus: 503 },
    }

    expect(resolveClassification(failure)).toEqual({
      status: 'unclassified',
      threadId,
      review: 'needs_review',
      reviewPriority: 'normal',
      reasons: ['provider_failure'],
    })
  })

  it.each([
    [0.8, 'auto_accepted', []],
    [0.79, 'needs_review', ['low_category_confidence']],
    [0.3, 'needs_review', ['low_category_confidence']],
  ])('with category probability %d, review is %s', (categoryShare, review, reasons) => {
    expect(resolve({ categoryShare })).toMatchObject({ review, reasons })
  })

  it('sends a confident "other" to review as ambiguous', () => {
    expect(resolve({ category: 'other', categoryShare: 0.95 })).toMatchObject({
      review: 'needs_review',
      reviewPriority: 'normal',
      reasons: ['ambiguous_category'],
    })
  })

  it('reports an uncertain priority without sending it to review', () => {
    expect(resolve({ priorityShare: 0.5 })).toMatchObject({
      priorityUncertain: true,
      review: 'auto_accepted',
      reasons: [],
    })
  })

  it.each(suspicionQuestions)('elevates review when %s fires', (question) => {
    expect(resolve({ nouls: { [question]: 0.4 } })).toMatchObject({
      review: 'needs_review',
      reviewPriority: 'elevated',
      reasons: ['suspicious'],
      suspicionSignals: [question],
    })
  })

  it('ignores suspicion signals below the floor', () => {
    expect(resolve({ nouls: { credential_request: 0.39 } })).toMatchObject({
      review: 'auto_accepted',
      suspicionSignals: [],
    })
  })

  it('never auto-accepts a confident suspicious category', () => {
    expect(resolve({ category: 'suspicious', categoryShare: 0.99 })).toMatchObject({
      review: 'needs_review',
      reviewPriority: 'elevated',
      reasons: ['suspicious'],
    })
  })

  it('lists every reason that applies', () => {
    const outcome = resolve({
      category: 'other',
      categoryShare: 0.4,
      priorityShare: 0.3,
      nouls: { sender_impersonation: 0.9, payment_redirect: 0.8 },
    })

    expect(outcome).toMatchObject({
      reasons: ['low_category_confidence', 'ambiguous_category', 'suspicious'],
      priorityUncertain: true,
      suspicionSignals: ['sender_impersonation', 'payment_redirect'],
    })
  })

  it('can only raise review when suspicion rises', () => {
    const bases: ResponseOptions[] = [
      {},
      { categoryShare: 0.5 },
      { category: 'other' },
      { category: 'suspicious' },
      { priorityShare: 0.3 },
    ]
    for (const base of bases) {
      for (const question of suspicionQuestions) {
        for (const noul of [0, 0.39, 0.4, 0.7, 1]) {
          const before = resolve(base)
          const after = resolve({ ...base, nouls: { [question]: noul } })

          expect(reviewRank(after)).toBeGreaterThanOrEqual(reviewRank(before))
          expect(after).toMatchObject({
            category: before.status === 'classified' && before.category,
          })
        }
      }
    }
  })

  it.each([
    [0.7, 'likely'],
    [0.69, 'uncertain'],
    [0.5, 'uncertain'],
    [0.31, 'uncertain'],
    [0.3, 'unlikely'],
  ])('reads a reply noul of %d as %s', (noul, replyExpected) => {
    expect(resolve({ nouls: { reply_expected: noul } })).toMatchObject({ replyExpected })
  })

  it('decides a near tie by the most probable label and sends it to review', () => {
    const base = classified()
    const outcome = resolveClassification({
      ...base,
      answers: {
        ...base.answers,
        category: {
          type: 'choice',
          choice: 'purchase',
          confidence: 0.35,
          probabilities: {
            personal: 0,
            purchase: 0.44,
            notification: 0.45,
            security: 0,
            newsletter: 0,
            promotion: 0.08,
            suspicious: 0.01,
            other: 0.02,
          },
        },
      },
    })

    expect(outcome).toMatchObject({
      category: 'notification',
      review: 'needs_review',
      reasons: ['low_category_confidence'],
    })
  })

  it('rescales raw probabilities without changing the decision', () => {
    const outcome = resolveClassification({
      ...classified(),
      answers: {
        ...classified().answers,
        category: {
          type: 'choice',
          choice: 'purchase',
          confidence: 0.8,
          probabilities: {
            personal: 0.05,
            purchase: 0.8496,
            notification: 0.05,
            security: 0,
            newsletter: 0.05,
            promotion: 0,
            suspicious: 0,
            other: 0,
          },
        },
      },
    })

    expect(outcome).toMatchObject({ category: 'purchase', review: 'auto_accepted' })
    expect(outcome.status === 'classified' && outcome.confidence).toBeCloseTo(0.85, 3)
  })
})

describe('classification and policy together', () => {
  const thread = threadSchema.parse(syntheticThreads.promptInjection)
  const classify = (body: unknown) =>
    createJevClassifier(() => Promise.resolve(body))({
      thread,
      mailboxAddress: 'inbox@example.com',
    })

  it('flags an email that tells the classifier to mark it safe', async () => {
    // As if the email had steered the category, but not the narrow check.
    const steered = jevResponse({
      category: 'personal',
      categoryShare: 0.95,
      priority: 'urgent',
      nouls: { automated_reader_instructions: 0.97 },
    })

    expect(resolveClassification(await classify(steered))).toMatchObject({
      category: 'personal',
      review: 'needs_review',
      reviewPriority: 'elevated',
      suspicionSignals: ['automated_reader_instructions'],
    })
  })

  it('sends a malformed response to review as a provider failure', async () => {
    expect(resolveClassification(await classify({ answers: {} }))).toMatchObject({
      status: 'unclassified',
      reasons: ['provider_failure'],
    })
  })

  it('sends a provider error to review', async () => {
    const failing = createJevClassifier(() => Promise.reject(new JevError('rate_limited')))

    expect(
      resolveClassification(await failing({ thread, mailboxAddress: 'inbox@example.com' })),
    ).toMatchObject({ status: 'unclassified', review: 'needs_review' })
  })
})
