/**
 * The offline release boundary for a pinned classifier change.
 *
 * A model score is one classifier output, not certainty. This gate therefore
 * compares those scores with reviewed labels and policy handling over the
 * exact same set. It decides whether code may merge; it authorizes no inbox
 * or mailbox action and imports no provider or mailbox adapter.
 */
import { z } from 'zod'
import { defaultRubric } from '../domain/rubric'
import type { QualitySlice, Tally } from './quality-report'
import { share, summarizeQuality } from './quality-report'
import { reviewedCases } from './reviewed-set'
import { replayRunSnapshot, runSnapshotSchema } from './run-snapshot'

const modelVersion = z.string().regex(/^jev-\d{1,3}\.\d{1,3}\.\d{1,3}$/)

/** One explicitly captured before/after comparison; it contains no mail. */
export const modelReleaseEvidenceSchema = z.strictObject({
  version: z.literal(1),
  fromClassifier: modelVersion,
  toClassifier: modelVersion,
  rubric: z.literal(defaultRubric.id),
  reviewerKind: z.literal('human'),
  reviewedBy: z.string().trim().min(1),
  reviewedOn: z.iso.date(),
  baseline: runSnapshotSchema,
  candidate: runSnapshotSchema,
})

export type ModelReleaseEvidence = z.infer<typeof modelReleaseEvidenceSchema>

/** The fixed, reviewable regression budget. Changing it is a policy change. */
export const modelReleaseCriteria = {
  minimumCategoryAgreement: 0.8,
  minimumPriorityAgreement: 0.75,
  minimumHandlingAgreement: 0.8,
  maximumCalibrationError: 0.2,
  maximumCalibrationRegression: 0.05,
  /** On today's 18 cases this permits at most one additional review. */
  maximumAdditionalReviewLoad: 1,
  maximumProviderFailures: 0,
} as const

export type ModelReleaseFailure =
  | 'evidence_versions'
  | 'reviewed_set'
  | 'snapshot_refused'
  | 'provider_failures'
  | 'category_floor'
  | 'category_regression'
  | 'category_slice_regression'
  | 'priority_floor'
  | 'priority_regression'
  | 'priority_slice_regression'
  | 'handling_floor'
  | 'handling_regression'
  | 'review_load_regression'
  | 'calibration_missing'
  | 'calibration_ceiling'
  | 'calibration_regression'

export type ModelReleaseAssessment =
  | Readonly<{ status: 'passed' }>
  | Readonly<{ status: 'failed'; failures: readonly ModelReleaseFailure[] }>

/**
 * Validate and compare two already-captured runs. Both are replayed locally;
 * nothing here can reach Jev, Spark, a mailbox or a database.
 */
export function assessModelRelease(
  evidence: ModelReleaseEvidence,
  fromClassifier: string,
  toClassifier: string,
): ModelReleaseAssessment {
  const failures = new Set<ModelReleaseFailure>()
  if (evidence.fromClassifier !== fromClassifier || evidence.toClassifier !== toClassifier) {
    failures.add('evidence_versions')
  }
  if (
    !coversSet(evidence.baseline, fromClassifier) ||
    !coversSet(evidence.candidate, toClassifier)
  ) {
    failures.add('reviewed_set')
  }
  const baseline = sliceOf(evidence.baseline)
  const candidate = sliceOf(evidence.candidate)
  if (baseline === null || candidate === null) failures.add('snapshot_refused')
  if (baseline !== null && candidate !== null) compareSlices(baseline, candidate, failures)
  return failures.size === 0 ? { status: 'passed' } : { status: 'failed', failures: [...failures] }
}

function coversSet(snapshot: z.infer<typeof runSnapshotSchema>, classifier: string): boolean {
  const fixtures = snapshot.entries.map(({ fixture }) => fixture)
  const expected = reviewedCases.map(({ fixture }) => fixture)
  return (
    fixtures.length === expected.length &&
    new Set(fixtures).size === fixtures.length &&
    expected.every((fixture) => fixtures.includes(fixture)) &&
    snapshot.entries.every(
      ({ requestedModel, rubric }) => requestedModel === classifier && rubric === defaultRubric.id,
    )
  )
}

function sliceOf(snapshot: z.infer<typeof runSnapshotSchema>): QualitySlice | null {
  const replay = replayRunSnapshot(snapshot)
  if (replay.status === 'refused') return null
  const report = summarizeQuality(replay.observations)
  return report.slices.length === 1 ? (report.slices[0] ?? null) : null
}

function compareSlices(
  baseline: QualitySlice,
  candidate: QualitySlice,
  failures: Set<ModelReleaseFailure>,
): void {
  const criteria = modelReleaseCriteria
  if (
    baseline.providerFailures.count > criteria.maximumProviderFailures ||
    candidate.providerFailures.count > criteria.maximumProviderFailures
  ) {
    failures.add('provider_failures')
  }
  compareAgreement(
    baseline.categoryAgreement,
    candidate.categoryAgreement,
    criteria.minimumCategoryAgreement,
    'category_floor',
    'category_regression',
    failures,
  )
  compareAgreement(
    baseline.priorityAgreement,
    candidate.priorityAgreement,
    criteria.minimumPriorityAgreement,
    'priority_floor',
    'priority_regression',
    failures,
  )
  compareAgreement(
    baseline.handlingAgreement,
    candidate.handlingAgreement,
    criteria.minimumHandlingAgreement,
    'handling_floor',
    'handling_regression',
    failures,
  )
  if (regressedLabels(baseline.byCategory, candidate.byCategory, 'category')) {
    failures.add('category_slice_regression')
  }
  if (regressedLabels(baseline.byPriority, candidate.byPriority, 'priority')) {
    failures.add('priority_slice_regression')
  }
  if (
    candidate.reviewRate.count >
    baseline.reviewRate.count + criteria.maximumAdditionalReviewLoad
  ) {
    failures.add('review_load_regression')
  }
  compareCalibration(baseline, candidate, failures)
}

function compareAgreement(
  baseline: Tally,
  candidate: Tally,
  floor: number,
  floorFailure: ModelReleaseFailure,
  regressionFailure: ModelReleaseFailure,
  failures: Set<ModelReleaseFailure>,
): void {
  const before = share(baseline)
  const after = share(candidate)
  if (after === null || after < floor) failures.add(floorFailure)
  if (before === null || after === null || after < before) failures.add(regressionFailure)
}

type LabelTally = Readonly<{ expected: number; agreed: number }>

function regressedLabels<
  L extends LabelTally & Record<K, string>,
  K extends 'category' | 'priority',
>(baseline: readonly L[], candidate: readonly L[], label: K): boolean {
  return baseline.some((before) => {
    const after = candidate.find((row) => row[label] === before[label])
    return after?.expected !== before.expected || after.agreed < before.agreed
  })
}

function compareCalibration(
  baseline: QualitySlice,
  candidate: QualitySlice,
  failures: Set<ModelReleaseFailure>,
): void {
  const before = baseline.calibration.expectedCalibrationError
  const after = candidate.calibration.expectedCalibrationError
  if (before === null || after === null) {
    failures.add('calibration_missing')
    return
  }
  if (after > modelReleaseCriteria.maximumCalibrationError) failures.add('calibration_ceiling')
  if (after > before + modelReleaseCriteria.maximumCalibrationRegression) {
    failures.add('calibration_regression')
  }
}
