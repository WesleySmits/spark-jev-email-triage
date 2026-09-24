import { describe, expect, it } from 'vitest'
import { jevFailure, jevJudgment } from '../jev/fixtures'
import { evaluationMailValues } from './fixtures'
import { formatQualityReport } from './quality-report-text'
import { summarizeQuality, type QualityObservation } from './quality-report'
import { reviewedCases } from './reviewed-set'

const reviewedFor = (fixture: string) => {
  const found = reviewedCases.find((reviewed) => reviewed.fixture === fixture)
  if (found === undefined) throw new Error(`No reviewed case for ${fixture}`)
  return found
}

const run = (): QualityObservation[] => [
  {
    reviewed: reviewedFor('customerQuestion'),
    classification: jevJudgment('thread-customer-question', { category: 'personal' }),
    latencyMs: 900,
  },
  {
    reviewed: reviewedFor('invoice'),
    classification: jevJudgment('thread-invoice', { category: 'personal' }),
    latencyMs: 700,
  },
  {
    reviewed: reviewedFor('suspicious'),
    classification: jevFailure('thread-suspicious'),
    latencyMs: 300,
  },
]

const rendered = (observations: readonly QualityObservation[]) =>
  formatQualityReport(summarizeQuality(observations))

/** Every case, answered as the set expects, so the whole set is rendered. */
const wholeSet = (): QualityObservation[] =>
  reviewedCases.map((reviewed) => ({
    reviewed,
    classification: jevJudgment(`thread-${reviewed.fixture}`, {
      category: reviewed.expectation.category,
    }),
    latencyMs: 800,
  }))

describe('formatQualityReport', () => {
  it('names what was observed', () => {
    expect(rendered(run())).toContain('Observations: 3')
  })

  it('names the rubric, the build that was asked and what answered', () => {
    expect(rendered(run())).toContain(
      'Rubric email-triage.v2, classifier jev-1.13.0 (answered by jev-1.13.0)',
    )
  })

  // A threshold is part of what a rubric means, so it is printed inside the
  // slice that names that rubric, never once over a whole report.
  it('names the thresholds inside the slice they produced, beside their rubric', () => {
    const text = rendered(run())

    expect(text).toContain(
      '  Thresholds of email-triage.v2: auto-accept 0.80, priority confidence 0.50, ' +
        'suspicion floor 0.40',
    )
    expect(text.indexOf('Thresholds of')).toBeGreaterThan(text.indexOf('Rubric email-triage.v2'))
  })

  it('prints each figure as its counts and the share they make', () => {
    const text = rendered(run())

    expect(text).toContain('Attempts: 3, provider failures 1/3 (33%): timeout 1')
    expect(text).toContain('Category agreement: 1/2 (50%)')
    expect(text).toContain('Disagreed on invoice: expected purchase, answered personal')
    expect(text).toContain('Priority agreement: 1/2 (50%)')
    expect(text).toContain('Priority disagreed on invoice: expected normal, answered high')
    expect(text).toContain('Uncertain priorities: 0/2 (0%)')
    expect(text).toContain('Review load: policy 0/2 (0%), the set expects 0/2 (0%)')
  })

  it('says why a figure it has no value for is missing', () => {
    const untimed = run().map((observation) => ({ ...observation, latencyMs: null }))

    expect(rendered(untimed)).toContain('Latency: unavailable (nothing measured it)')
  })

  // Token counts are the provider's own; a price per token is nowhere in
  // this repository, so the cost in money stays unavailable.
  it('reports tokens and never a cost in money', () => {
    const text = rendered(run())

    expect(text).toContain('Tokens: 1624 in, 128 out, over 2 answers')
    expect(text).toContain(
      'Cost in money: unavailable (no price per token is recorded in this repository)',
    )
  })

  it('renders the same report the same way every time', () => {
    expect(rendered(run())).toBe(rendered(run()))
  })

  // The report is printed, logged and pasted into tickets, so nothing from
  // the mail it measures may reach it.
  it('carries no subject, body, address, name or attachment from the mail it measures', () => {
    const text = rendered(wholeSet())

    for (const value of evaluationMailValues) expect(text).not.toContain(value)
  })
})
