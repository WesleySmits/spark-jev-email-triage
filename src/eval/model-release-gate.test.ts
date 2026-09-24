import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { JevClassification } from '../jev/classifier'
import { jevFailure, jevJudgment } from '../jev/fixtures'
import { evaluationMailValues } from './fixtures'
import {
  assessModelRelease,
  modelReleaseCriteria,
  modelReleaseEvidenceSchema,
  type ModelReleaseEvidence,
  type ModelReleaseFailure,
} from './model-release-gate'
import type { QualityObservation } from './quality-report'
import { reviewedCases } from './reviewed-set'
import { captureRunSnapshot, runSnapshotSchema } from './run-snapshot'

const fromClassifier = 'jev-1.12.0'
const toClassifier = 'jev-1.13.0'

type Change = (
  classification: JevClassification,
  fixture: (typeof reviewedCases)[number]['fixture'],
  index: number,
) => JevClassification

function run(classifier: string, change: Change = (classification) => classification) {
  return reviewedCases.map((reviewed, index): QualityObservation => {
    const classification = jevJudgment(`thread-${reviewed.fixture}`, {
      category: reviewed.expectation.category,
      priority: reviewed.expectation.priority,
    })
    if (classification.status !== 'classified') throw new Error('Expected a synthetic answer')
    return {
      reviewed,
      classification: change(
        { ...classification, requestedModel: classifier, model: classifier },
        reviewed.fixture,
        index,
      ),
      latencyMs: null,
    }
  })
}

function evidence(candidateChange?: Change): ModelReleaseEvidence {
  return {
    version: 1,
    fromClassifier,
    toClassifier,
    rubric: 'email-triage.v2',
    reviewerKind: 'human',
    reviewedBy: 'Release reviewer',
    reviewedOn: '2026-09-24',
    baseline: captureRunSnapshot(run(fromClassifier), '2026-09-24T10:00:00Z'),
    candidate: captureRunSnapshot(run(toClassifier, candidateChange), '2026-09-24T10:30:00Z'),
  }
}

const failuresOf = (reviewed: ModelReleaseEvidence): readonly ModelReleaseFailure[] => {
  const result = assessModelRelease(reviewed, fromClassifier, toClassifier)
  return result.status === 'failed' ? result.failures : []
}

describe('model release evidence', () => {
  it('is versioned, reviewed and contains two replayable run snapshots', () => {
    expect(modelReleaseEvidenceSchema.parse(evidence())).toMatchObject({
      version: 1,
      fromClassifier,
      toClassifier,
      reviewerKind: 'human',
      reviewedBy: 'Release reviewer',
    })
  })

  it('contains no mail even when it covers the whole reviewed set', () => {
    const written = JSON.stringify(evidence())

    for (const value of evaluationMailValues) expect(written).not.toContain(value)
  })

  it('has no provider, Spark or mailbox-action dependency', () => {
    const source = [
      readFileSync(new URL('./model-release-gate.ts', import.meta.url), 'utf8'),
      readFileSync(new URL('./model-release-command.ts', import.meta.url), 'utf8'),
    ].join('\n')

    expect(source).not.toMatch(/from ['"]\.\.\/(actions|spark)/)
    expect(source).not.toMatch(/createJevClassifier|createSdkTransport|TYPESAFE_API_KEY/)
  })
})

describe('assessModelRelease', () => {
  it('passes an exact, complete before/after run that meets every criterion', () => {
    expect(assessModelRelease(evidence(), fromClassifier, toClassifier)).toEqual({
      status: 'passed',
    })
  })

  it('binds evidence to the exact classifier transition and rubric', () => {
    expect(failuresOf({ ...evidence(), fromClassifier: 'jev-1.11.0' })).toContain(
      'evidence_versions',
    )
  })

  it('requires every reviewed fixture exactly once under the named model', () => {
    const reviewed = evidence()
    const [first, ...rest] = reviewed.candidate.entries
    if (first === undefined) throw new Error('Expected reviewed cases')
    const candidate = runSnapshotSchema.parse({
      ...reviewed.candidate,
      entries: [...rest, rest[0]],
    })

    expect(failuresOf({ ...reviewed, candidate })).toContain('reviewed_set')
  })

  it('rejects provider failures instead of treating them as model disagreement', () => {
    const failed: Change = (classification, fixture, index) =>
      index === 0
        ? { ...jevFailure(`thread-${fixture}`), requestedModel: toClassifier }
        : classification

    expect(failuresOf(evidence(failed))).toContain('provider_failures')
  })

  it('rejects category regressions overall and within a category', () => {
    const worse: Change = (classification, fixture, index) =>
      index < 4 ? changed(classification, fixture, { category: 'other' }) : classification
    const failures = failuresOf(evidence(worse))

    expect(failures).toContain('category_floor')
    expect(failures).toContain('category_regression')
    expect(failures).toContain('category_slice_regression')
  })

  it('rejects priority regressions overall and within a priority', () => {
    const worse: Change = (classification, fixture, index) =>
      index < 5 ? changed(classification, fixture, { priority: 'low' }) : classification
    const failures = failuresOf(evidence(worse))

    expect(failures).toContain('priority_floor')
    expect(failures).toContain('priority_regression')
    expect(failures).toContain('priority_slice_regression')
  })

  it('rejects extra review load and handling regression from low category scores', () => {
    const lower: Change = (classification, fixture, index) => {
      const reviewed = reviewedCases[index]
      if (reviewed === undefined) throw new Error('Expected a reviewed case')
      return index < 4
        ? changed(classification, fixture, {
            category: reviewed.expectation.category,
            categoryShare: 0.7,
          })
        : classification
    }
    const failures = failuresOf(evidence(lower))

    expect(failures).toContain('handling_regression')
    expect(failures).toContain('review_load_regression')
  })

  it('rejects uncalibrated scores even when every chosen label agrees', () => {
    const overconfident: Change = (classification, fixture, index) => {
      const reviewed = reviewedCases[index]
      if (reviewed === undefined) throw new Error('Expected a reviewed case')
      return changed(classification, fixture, {
        category: reviewed.expectation.category,
        categoryShare: 0.7,
      })
    }
    const failures = failuresOf(evidence(overconfident))

    expect(failures).toContain('calibration_ceiling')
    expect(failures).toContain('calibration_regression')
  })

  it('publishes the concrete criterion as ordinary reviewable data', () => {
    expect(modelReleaseCriteria).toEqual({
      minimumCategoryAgreement: 0.8,
      minimumPriorityAgreement: 0.75,
      minimumHandlingAgreement: 0.8,
      maximumCalibrationError: 0.2,
      maximumCalibrationRegression: 0.05,
      maximumAdditionalReviewLoad: 1,
      maximumProviderFailures: 0,
    })
  })
})

function changed(
  classification: JevClassification,
  fixture: string,
  options: Parameters<typeof jevJudgment>[1],
): JevClassification {
  const answer = jevJudgment(`thread-${fixture}`, options)
  if (answer.status !== 'classified') throw new Error('Expected a synthetic answer')
  return {
    ...answer,
    requestedModel: classification.requestedModel,
    model: classification.status === 'classified' ? classification.model : toClassifier,
  }
}
