/**
 * What one evaluation run says about triage quality, counted from the
 * reviewed evaluation set and the answers a classifier gave for it.
 *
 * The report is a pure function of what it is handed: the same observations
 * always produce the same report, in any order they arrive, so a run can be
 * recomputed from its answers instead of being believed. Nothing here calls
 * a provider, reads a mailbox or looks at a clock.
 *
 * What it counts, and why each figure is kept apart:
 *
 * - Category quality is agreement with the expectation a person settled on,
 *   per category and over the run. Both directions are counted — how often a
 *   category was expected and how often it was answered — because a
 *   classifier that answers `other` for everything agrees with every `other`
 *   case while being useless.
 * - The review rate is the share of judged threads policy sends to a person.
 *   The set's own share is reported beside it: the two answer different
 *   questions, and a run that reviews the right number of the wrong threads
 *   is not a run that did well.
 * - Calibration compares the confidence of the chosen category with how
 *   often that choice agreed. It is reported to be read, never to move a
 *   threshold on its own: `defaultRubric.thresholds` are not calibrated, the
 *   set is small, and a threshold changed from a handful of cases would be
 *   fitted to them. Each slice names the thresholds its figures were
 *   produced under, so a later run is comparable with this one.
 * - Provider failures are counted as their own rate over attempts and stay
 *   out of every quality figure. A failure is no judgment: counting it as a
 *   disagreement blames the set for an outage, and counting it as agreement
 *   flatters it.
 *
 * Figures are split by rubric and by the pinned classifier build that was
 * asked, because a category, a priority and a threshold mean what a rubric
 * version says they mean, and two builds are two classifiers. The versioned
 * models that actually answered are named beside the build, so an alias that
 * moved under a pinned name is visible rather than averaged away.
 *
 * Only a rubric this build still holds can be counted, and `reportableRubrics`
 * says which. A run judged under an older rubric was judged under other
 * meanings and other thresholds, and this build kept neither: counting it
 * here would apply today's policy to yesterday's judgments and then print
 * today's thresholds beside them, as though they were the ones that produced
 * the figures. Such a run is refused where it enters — see
 * `replayRunSnapshot` in `run-snapshot.ts`, the one door untyped runs come
 * through — rather than reported under a rubric it was never judged under.
 * Every threshold therefore belongs to the slice that names its rubric, not
 * to the report as a whole.
 *
 * Nothing depends on the order observations arrive in. Sums over
 * floating-point confidences do depend on the order they are added in, so
 * the judged rows are put in one canonical order before anything is summed.
 *
 * Latency and cost are reported only as far as the source data reaches.
 * Latency is whatever measured the call, and is `not_measured` when nothing
 * did. Tokens come from the provider's own usage figures. Money never does:
 * this repository holds no price per token, so the cost in money is
 * `no_price_data` rather than a number nobody can stand behind.
 *
 * The report names fixtures, categories, counts and content-free failure
 * codes. No subject, address, body or provider text enters it, so it may be
 * printed, logged and pasted as it is.
 */
import type { z } from 'zod'
import { defaultRubric, triageCategories } from '../domain/rubric'
import { currentTriageRubric, type categorySchema } from '../domain/triage'
import type { JevClassification } from '../jev/classifier'
import { resolveClassification } from '../jev/policy'
import { handlingAgrees } from './handling-agreement'
import type { ReviewedCase } from './reviewed-set'

type Category = z.infer<typeof categorySchema>

/** One reviewed case, and what one classifier answered for it. */
export interface QualityObservation {
  reviewed: ReviewedCase
  classification: JevClassification
  /** Wall-clock milliseconds of the call, or `null` when nothing timed it. */
  latencyMs: number | null
}

/** A count and what it is out of. `total` may be 0, and then says so. */
export interface Tally {
  count: number
  total: number
}

/** How often a category was expected, answered, and both at once. */
export interface CategoryTally {
  category: Category
  expected: number
  answered: number
  agreed: number
}

/** Judged threads whose confidence fell in `[from, to)`, and how they did. */
export interface CalibrationBin {
  from: number
  to: number
  judged: number
  meanConfidence: number
  agreement: Tally
}

/** Why a figure has no value, in codes that name no mail. */
export type Unavailable = Readonly<{
  status: 'unavailable'
  reason: 'not_measured' | 'no_price_data'
}>

export type Measured<T> = Readonly<{ status: 'measured' } & T> | Unavailable

export interface LatencySummary {
  /** Attempts that carried a measurement, which may be fewer than all. */
  samples: number
  medianMs: number
  slowestMs: number
}

export interface TokenSummary {
  /** Answers the provider reported usage for. A failure reports none. */
  samples: number
  inputTokens: number
  outputTokens: number
}

/** One rubric and one pinned classifier build, and how they did. */
export interface QualitySlice {
  rubric: string
  /**
   * The thresholds this build holds for `rubric`, which are the ones policy
   * applied to every figure below. Only a reportable rubric reaches a slice,
   * so these are never another rubric's thresholds shown beside its run.
   */
  thresholds: typeof defaultRubric.thresholds
  /** The build that was asked, as a stored judgment names it. */
  classifierVersion: string
  /** The versioned models that answered, sorted. */
  answeredBy: readonly string[]
  attempts: number
  providerFailures: Tally
  /** Content-free provider codes, by how often each occurred. */
  failureCodes: readonly { code: string; count: number }[]
  judged: number
  categoryAgreement: Tally
  byCategory: readonly CategoryTally[]
  /** Every judged case whose category differs from the expectation. */
  disagreements: readonly { fixture: string; expected: Category; answered: Category }[]
  /** Judged threads policy sends to a person. */
  reviewRate: Tally
  /** Judged threads the set wants in front of a person. */
  expectedReviewRate: Tally
  handlingAgreement: Tally
  calibration: {
    bins: readonly CalibrationBin[]
    /** Confidence weighed against agreement, or `null` with nothing judged. */
    expectedCalibrationError: number | null
  }
  latency: Measured<LatencySummary>
  cost: {
    tokens: Measured<TokenSummary>
    /** Always unavailable: no price per token is recorded in this repository. */
    money: Unavailable
  }
}

export interface QualityReport {
  observed: number
  slices: readonly QualitySlice[]
}

/**
 * The rubric versions a run can be counted under: the ones whose meanings
 * and thresholds this build still holds. There is one, and `triage.ts` keeps
 * old ids parseable on purpose, so a run naming another rubric reads back
 * fine and is refused here rather than misread.
 */
export const reportableRubrics = [currentTriageRubric] as const

/** Whether this build can count a run that names `rubric`. */
export const isReportableRubric = (rubric: string): rubric is typeof currentTriageRubric =>
  reportableRubrics.some((reportable) => reportable === rubric)

/** One judged observation, reduced to what the figures count. */
interface JudgedRow {
  fixture: string
  expected: Category
  answered: Category
  agreed: boolean
  confidence: number
  needsReview: boolean
  expectsPerson: boolean
  handlingAgreed: boolean
}

const tally = (count: number, total: number): Tally => ({ count, total })

/** One order for two strings, the same in every locale. */
function compare(left: string, right: string): number {
  if (left < right) return -1
  return left > right ? 1 : 0
}

/**
 * One order for the judged rows, whatever order their observations arrived
 * in. Two rows that tie on this key carry the same confidence, so the
 * sequence of numbers a sum sees is decided by the run rather than by the
 * order it was handed over, and a float sum cannot drift with it.
 */
const canonically = (left: JudgedRow, right: JudgedRow) =>
  compare(left.fixture, right.fixture) ||
  compare(left.answered, right.answered) ||
  left.confidence - right.confidence

/** The share a tally describes, or `null` when it counts nothing. */
export const share = ({ count, total }: Tally) => (total === 0 ? null : count / total)

/**
 * The report for one run. Observations may arrive in any order and are
 * grouped, sorted and counted the same way every time.
 */
export function summarizeQuality(observations: readonly QualityObservation[]): QualityReport {
  const groups = new Map<string, QualityObservation[]>()
  for (const observation of observations) {
    const { rubric, requestedModel } = observation.classification
    const key = JSON.stringify([rubric, requestedModel])
    const group = groups.get(key) ?? []
    group.push(observation)
    groups.set(key, group)
  }
  const slices = [...groups.entries()]
    .sort(([left], [right]) => compare(left, right))
    .map(([, group]) => sliceOf(group))
  return { observed: observations.length, slices }
}

/** Every figure for one rubric and one pinned classifier build. */
function sliceOf(observations: readonly QualityObservation[]): QualitySlice {
  const [first] = observations
  if (first === undefined) throw new Error('A slice needs at least one observation')
  const failures = observations.flatMap(({ classification }) =>
    classification.status === 'provider_failure' ? [classification.failure.code] : [],
  )
  const rows = observations.flatMap(judgedRow).sort(canonically)
  const agreed = rows.filter((row) => row.agreed)
  return {
    rubric: first.classification.rubric,
    thresholds: defaultRubric.thresholds,
    classifierVersion: first.classification.requestedModel,
    answeredBy: [
      ...new Set(
        observations.flatMap(({ classification }) =>
          classification.status === 'classified' ? [classification.model] : [],
        ),
      ),
    ].sort(),
    attempts: observations.length,
    providerFailures: tally(failures.length, observations.length),
    failureCodes: countCodes(failures),
    judged: rows.length,
    categoryAgreement: tally(agreed.length, rows.length),
    byCategory: categoryTallies(rows),
    disagreements: rows
      .filter((row) => !row.agreed)
      .map(({ fixture, expected, answered }) => ({ fixture, expected, answered })),
    reviewRate: tally(rows.filter((row) => row.needsReview).length, rows.length),
    expectedReviewRate: tally(rows.filter((row) => row.expectsPerson).length, rows.length),
    handlingAgreement: tally(rows.filter((row) => row.handlingAgreed).length, rows.length),
    calibration: calibrationOf(rows),
    latency: latencyOf(observations),
    cost: {
      tokens: tokensOf(observations),
      money: { status: 'unavailable', reason: 'no_price_data' },
    },
  }
}

/**
 * The row a judged observation contributes, or none at all. A provider
 * failure is no judgment, so it leaves every quality figure alone.
 */
function judgedRow({ reviewed, classification }: QualityObservation): JudgedRow[] {
  const outcome = resolveClassification(classification)
  if (outcome.status !== 'classified') return []
  const { expectation } = reviewed
  return [
    {
      fixture: reviewed.fixture,
      expected: expectation.category,
      answered: outcome.category,
      agreed: outcome.category === expectation.category,
      confidence: outcome.confidence,
      needsReview: outcome.review === 'needs_review',
      expectsPerson: expectation.handling === 'needs_person',
      handlingAgreed: handlingAgrees(expectation, outcome) === true,
    },
  ]
}

/** Failure codes, most frequent first and then by code, for one slice. */
function countCodes(codes: readonly string[]) {
  const counts = new Map<string, number>()
  for (const code of codes) counts.set(code, (counts.get(code) ?? 0) + 1)
  return [...counts.entries()]
    .map(([code, count]) => ({ code, count }))
    .sort((left, right) => right.count - left.count || compare(left.code, right.code))
}

/**
 * Every category the run expected or answered, in rubric order. A category
 * nobody expected and nobody answered is left out rather than printed as a
 * row of zeros.
 */
function categoryTallies(rows: readonly JudgedRow[]): CategoryTally[] {
  return triageCategories
    .map((category) => ({
      category,
      expected: rows.filter((row) => row.expected === category).length,
      answered: rows.filter((row) => row.answered === category).length,
      agreed: rows.filter((row) => row.agreed && row.expected === category).length,
    }))
    .filter(({ expected, answered }) => expected > 0 || answered > 0)
}

/** Ten bins of a tenth each; a confidence of exactly 1 falls in the last. */
const binIndex = (confidence: number) => Math.min(9, Math.floor(confidence * 10))

/**
 * Confidence against agreement, in the bins that hold something, with the
 * error each bin contributes weighed by how much of the run it holds.
 */
function calibrationOf(rows: readonly JudgedRow[]): QualitySlice['calibration'] {
  const bins = [...Array(10).keys()]
    .map((index) => ({ index, held: rows.filter((row) => binIndex(row.confidence) === index) }))
    .filter(({ held }) => held.length > 0)
    .map(({ index, held }) => ({
      from: index / 10,
      to: (index + 1) / 10,
      judged: held.length,
      meanConfidence: held.reduce((sum, row) => sum + row.confidence, 0) / held.length,
      agreement: tally(held.filter((row) => row.agreed).length, held.length),
    }))
  const error = bins.reduce(
    (sum, bin) =>
      sum +
      (bin.judged / rows.length) * Math.abs(bin.meanConfidence - bin.agreement.count / bin.judged),
    0,
  )
  return { bins, expectedCalibrationError: rows.length === 0 ? null : error }
}

/** What was timed, or why nothing was. Failed attempts count too: they took time. */
function latencyOf(observations: readonly QualityObservation[]): Measured<LatencySummary> {
  const measured = observations
    .flatMap(({ latencyMs }) => (latencyMs === null ? [] : [latencyMs]))
    .sort((left, right) => left - right)
  const slowest = measured.at(-1)
  if (slowest === undefined) return { status: 'unavailable', reason: 'not_measured' }
  return {
    status: 'measured',
    samples: measured.length,
    medianMs: median(measured),
    slowestMs: slowest,
  }
}

/** The middle of a sorted run, or the mean of the two middles. */
function median(sorted: readonly number[]): number {
  const middle = Math.floor(sorted.length / 2)
  const above = sorted[middle] ?? 0
  return sorted.length % 2 === 1 ? above : ((sorted[middle - 1] ?? 0) + above) / 2
}

/** The provider's own usage figures, which a failed call never carries. */
function tokensOf(observations: readonly QualityObservation[]): Measured<TokenSummary> {
  const usages = observations.flatMap(({ classification }) =>
    classification.status === 'classified' ? [classification.usage] : [],
  )
  if (usages.length === 0) return { status: 'unavailable', reason: 'not_measured' }
  return {
    status: 'measured',
    samples: usages.length,
    inputTokens: usages.reduce((sum, usage) => sum + usage.inputTokens, 0),
    outputTokens: usages.reduce((sum, usage) => sum + usage.outputTokens, 0),
  }
}
