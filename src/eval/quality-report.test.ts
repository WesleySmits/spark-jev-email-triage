import { describe, expect, it } from 'vitest'
import { defaultRubric } from '../domain/rubric'
import type { JevClassification } from '../jev/classifier'
import type { JevErrorCode } from '../jev/errors'
import { jevFailure, jevJudgment } from '../jev/fixtures'
import type { ResponseOptions } from '../jev/fixtures'
import {
  isReportableRubric,
  reportableRubrics,
  share,
  summarizeQuality,
  type QualityObservation,
} from './quality-report'
import { reviewedCases } from './reviewed-set'

type Fixture = (typeof reviewedCases)[number]['fixture']

function reviewedFor(fixture: Fixture) {
  const found = reviewedCases.find((reviewed) => reviewed.fixture === fixture)
  if (found === undefined) throw new Error(`No reviewed case for ${fixture}`)
  return found
}

/** One case, the answer a classifier gave for it, and what timed the call. */
const observe = (
  fixture: Fixture,
  classification: JevClassification,
  latencyMs: number | null = null,
): QualityObservation => ({ reviewed: reviewedFor(fixture), classification, latencyMs })

const answered = (fixture: Fixture, options: ResponseOptions) =>
  jevJudgment(`thread-${fixture}`, options)

const failed = (fixture: Fixture, code: JevErrorCode): JevClassification => ({
  rubric: defaultRubric.id,
  requestedModel: 'jev-1.13.0',
  threadId: `thread-${fixture}`,
  status: 'provider_failure',
  failure: { code, detail: null, httpStatus: null },
})

/**
 * Three judged cases and one outage: `invoice` is answered `personal`, and
 * `newsletter` is answered `other`, which is what the set expects of it.
 */
const run = (): QualityObservation[] => [
  observe('customerQuestion', answered('customerQuestion', { category: 'personal' }), 900),
  observe('invoice', answered('invoice', { category: 'personal' }), 700),
  observe('newsletter', answered('newsletter', { category: 'other', categoryShare: 0.95 }), 1100),
  observe('suspicious', jevFailure('thread-suspicious'), 300),
]

const onlySlice = (observations: readonly QualityObservation[]) => {
  const [slice] = summarizeQuality(observations).slices
  if (slice === undefined) throw new Error('Expected one slice')
  return slice
}

describe('summarizeQuality', () => {
  // A threshold belongs to the rubric whose meanings it is part of, so it
  // is named inside the slice that names that rubric and nowhere else.
  it('names, in each slice, the thresholds its own figures were produced under', () => {
    const slice = onlySlice(run())

    expect(slice.rubric).toBe(defaultRubric.id)
    expect(slice.thresholds).toEqual(defaultRubric.thresholds)
  })

  it('reports nothing at all for no observations', () => {
    expect(summarizeQuality([])).toEqual({ observed: 0, slices: [] })
  })

  // A failure is no judgment, so it belongs to its own rate and to no other.
  it('counts provider failures as their own rate, by their content-free code', () => {
    const slice = onlySlice(run())

    expect(slice.attempts).toBe(4)
    expect(slice.providerFailures).toEqual({ count: 1, total: 4 })
    expect(slice.failureCodes).toEqual([{ code: 'timeout', count: 1 }])
    expect(slice.judged).toBe(3)
  })

  it('counts category agreement over judged threads only', () => {
    expect(onlySlice(run()).categoryAgreement).toEqual({ count: 2, total: 3 })
  })

  // Agreement alone hides a classifier that answers one category for
  // everything, so both directions are counted.
  it('counts how often each category was expected and how often it was answered', () => {
    expect(onlySlice(run()).byCategory).toEqual([
      { category: 'personal', expected: 1, answered: 2, agreed: 1 },
      { category: 'purchase', expected: 1, answered: 0, agreed: 0 },
      { category: 'other', expected: 1, answered: 1, agreed: 1 },
    ])
  })

  it('names every judged case it disagreed with', () => {
    expect(onlySlice(run()).disagreements).toEqual([
      { fixture: 'invoice', expected: 'purchase', answered: 'personal' },
    ])
  })

  it('reports priority agreement, coverage and disagreements separately from category', () => {
    const slice = onlySlice(run())

    expect(slice.priorityAgreement).toEqual({ count: 1, total: 3 })
    expect(slice.byPriority).toEqual([
      { priority: 'high', expected: 1, answered: 3, agreed: 1 },
      { priority: 'normal', expected: 2, answered: 0, agreed: 0 },
    ])
    expect(slice.priorityDisagreements).toEqual([
      { fixture: 'invoice', expected: 'normal', answered: 'high' },
      { fixture: 'newsletter', expected: 'normal', answered: 'high' },
    ])
  })

  it('reports uncertain priority without turning it into category uncertainty or review', () => {
    const uncertain = [
      observe(
        'uncertainPriority',
        answered('uncertainPriority', {
          category: 'personal',
          priority: 'normal',
          priorityShare: 0.45,
        }),
      ),
    ]
    const slice = onlySlice(uncertain)

    expect(slice.priorityAgreement).toEqual({ count: 1, total: 1 })
    expect(slice.uncertainPriorities).toEqual({ count: 1, total: 1 })
    expect(slice.reviewRate).toEqual({ count: 0, total: 1 })
  })

  it('reports what policy reviewed beside what the set expects, and their agreement', () => {
    const slice = onlySlice(run())

    expect(slice.reviewRate).toEqual({ count: 1, total: 3 })
    expect(slice.expectedReviewRate).toEqual({ count: 1, total: 3 })
    expect(slice.handlingAgreement).toEqual({ count: 3, total: 3 })
  })

  it('keeps several provider failure kinds outside all model-quality totals', () => {
    const failures = [
      observe('securityIncident', failed('securityIncident', 'rate_limited')),
      observe('invoiceDueToday', failed('invoiceDueToday', 'unavailable')),
      observe('subscribedNewsletter', failed('subscribedNewsletter', 'rate_limited')),
    ]
    const slice = onlySlice(failures)

    expect(slice.providerFailures).toEqual({ count: 3, total: 3 })
    expect(slice.failureCodes).toEqual([
      { code: 'rate_limited', count: 2 },
      { code: 'unavailable', count: 1 },
    ])
    expect(slice.categoryAgreement).toEqual({ count: 0, total: 0 })
    expect(slice.priorityAgreement).toEqual({ count: 0, total: 0 })
    expect(slice.reviewRate).toEqual({ count: 0, total: 0 })
    expect(slice.calibration).toEqual({ bins: [], expectedCalibrationError: null })
  })

  it('bins confidence against agreement and weighs the error by what each bin holds', () => {
    const { bins, expectedCalibrationError } = onlySlice(run()).calibration
    const [highest] = bins

    expect(bins).toHaveLength(1)
    expect(highest).toMatchObject({
      from: 0.9,
      to: 1,
      judged: 3,
      agreement: { count: 2, total: 3 },
    })
    expect(highest?.meanConfidence).toBeCloseTo((0.9 + 0.9 + 0.95) / 3, 10)
    expect(expectedCalibrationError).toBeCloseTo(0.25, 10)
  })

  it('puts certainty in the highest bin rather than one of its own', () => {
    const certain = [
      observe('invoice', answered('invoice', { category: 'purchase', categoryShare: 1 })),
    ]

    expect(onlySlice(certain).calibration.bins).toEqual([
      { from: 0.9, to: 1, judged: 1, meanConfidence: 1, agreement: { count: 1, total: 1 } },
    ])
  })

  it('has no calibration error to report when nothing was judged', () => {
    const outage = [observe('invoice', jevFailure('thread-invoice'))]

    expect(onlySlice(outage).calibration).toEqual({ bins: [], expectedCalibrationError: null })
  })

  // A rubric version decides what a category, a priority and a threshold
  // mean, and two classifier builds are two classifiers.
  it('splits figures by rubric and by the classifier build that was asked', () => {
    const older = {
      ...answered('invoice', { category: 'purchase' }),
      requestedModel: 'jev-1.12.0',
      model: 'jev-1.12.0',
    }
    const report = summarizeQuality([...run(), observe('invoice', older)])

    expect(report.observed).toBe(5)
    expect(report.slices.map((slice) => slice.classifierVersion)).toEqual([
      'jev-1.12.0',
      'jev-1.13.0',
    ])
    expect(report.slices.map((slice) => slice.attempts)).toEqual([1, 4])
    expect(report.slices.every((slice) => slice.rubric === defaultRubric.id)).toBe(true)
  })

  // An alias that moved under a pinned name must be visible, not averaged in.
  it('names the versioned models that answered under one pinned build', () => {
    const moved = { ...answered('invoice', { category: 'purchase' }), model: 'jev-1.13.1' }

    expect(onlySlice([...run(), observe('invoice', moved)]).answeredBy).toEqual([
      'jev-1.13.0',
      'jev-1.13.1',
    ])
  })

  it('reports the timings it was given, over the attempts that carried one', () => {
    expect(onlySlice(run()).latency).toEqual({
      status: 'measured',
      samples: 4,
      medianMs: 800,
      slowestMs: 1100,
    })
  })

  it('counts only the attempts something timed, and says how many those were', () => {
    const partly = run().map((observation, index) =>
      index === 0 ? observation : { ...observation, latencyMs: null },
    )

    expect(onlySlice(partly).latency).toEqual({
      status: 'measured',
      samples: 1,
      medianMs: 900,
      slowestMs: 900,
    })
  })

  // An unmeasured latency and a fast one must never read alike.
  it('reports latency as unavailable when nothing timed the calls', () => {
    const untimed = run().map((observation) => ({ ...observation, latencyMs: null }))

    expect(onlySlice(untimed).latency).toEqual({ status: 'unavailable', reason: 'not_measured' })
  })

  it("sums the provider's own token usage over the answers that carried it", () => {
    expect(onlySlice(run()).cost.tokens).toEqual({
      status: 'measured',
      samples: 3,
      inputTokens: 812 * 3,
      outputTokens: 64 * 3,
    })
  })

  it('reports no tokens for a run that was never answered', () => {
    const outage = [observe('invoice', jevFailure('thread-invoice'))]

    expect(onlySlice(outage).cost.tokens).toEqual({ status: 'unavailable', reason: 'not_measured' })
  })

  // No price per token is recorded anywhere in this repository, and a cost
  // nobody can stand behind is worse than none.
  it('never reports a cost in money', () => {
    expect(onlySlice(run()).cost.money).toEqual({ status: 'unavailable', reason: 'no_price_data' })
  })

  // A report a run cannot be recomputed from is a claim, not evidence.
  it('reports the same figures whatever order the observations arrive in', () => {
    const observations = run()

    expect(summarizeQuality([...observations].reverse())).toEqual(summarizeQuality(observations))
  })

  // Sums over floats depend on the order they are added in, so every
  // arrangement of one run must give one mean and one calibration error.
  it('gives one mean confidence and one calibration error for every arrangement', () => {
    const observations = run()
    const arrangements = observations.map((_, index) => [
      ...observations.slice(index),
      ...observations.slice(0, index),
    ])
    const figures = arrangements.map((arrangement) => {
      const { bins, expectedCalibrationError } = onlySlice(arrangement).calibration
      return { means: bins.map((bin) => bin.meanConfidence), expectedCalibrationError }
    })

    for (const figure of figures) expect(figure).toEqual(figures[0])
  })
})

describe('isReportableRubric', () => {
  it('is the rubric this build holds', () => {
    expect(reportableRubrics).toEqual([defaultRubric.id])
    expect(isReportableRubric(defaultRubric.id)).toBe(true)
  })

  // Old ids stay parseable on purpose, so a run naming one reads back fine
  // and must be refused rather than counted under today's thresholds.
  it('is not a rubric whose meanings and thresholds this build no longer holds', () => {
    expect(isReportableRubric('email-triage.v1')).toBe(false)
    expect(isReportableRubric('')).toBe(false)
  })
})

describe('share', () => {
  it('is the share a tally describes', () => {
    expect(share({ count: 3, total: 4 })).toBe(0.75)
  })

  it('is nothing at all when the tally counts nothing', () => {
    expect(share({ count: 0, total: 0 })).toBeNull()
  })
})
