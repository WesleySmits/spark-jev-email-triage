/**
 * The quality report as plain text, for a terminal, a log or a ticket.
 *
 * Rendering is kept apart from counting so the figures can be read back by
 * code without going through prose, and so the text can change without any
 * figure changing. It is deterministic: the same report always renders the
 * same lines.
 *
 * A figure that has no value says which one it is missing and why, in the
 * report's own words. Nothing is filled in with a zero, a dash or an
 * estimate: an unmeasured latency and a fast one must never read alike.
 *
 * The text names fixtures, categories, counts and content-free failure
 * codes, exactly as the report does, so it carries no mail. See
 * `quality-report.ts` for what each figure means.
 */
import type {
  CalibrationBin,
  CategoryTally,
  Measured,
  PriorityTally,
  QualityReport,
  QualitySlice,
  Tally,
} from './quality-report'
import { share } from './quality-report'

/** `3/4 (75%)`, or `0/0` when there is nothing to take a share of. */
function ratio(counted: Tally): string {
  const part = share(counted)
  const of = `${String(counted.count)}/${String(counted.total)}`
  return part === null ? of : `${of} (${String(Math.round(part * 100))}%)`
}

const decimals = (value: number, places = 2) => value.toFixed(places)

/** The whole report, one slice after another. */
export function formatQualityReport(report: QualityReport): string {
  return [
    'Triage quality on the reviewed evaluation set',
    `Observations: ${String(report.observed)}`,
    ...report.slices.flatMap((slice) => ['', ...formatSlice(slice)]),
  ].join('\n')
}

/**
 * One rubric and one pinned classifier build. Its thresholds are printed
 * inside it, beside the rubric they belong to, so no figure is ever read
 * under thresholds that did not produce it.
 */
function formatSlice(slice: QualitySlice): string[] {
  const answered = slice.answeredBy.length === 0 ? 'nothing answered' : slice.answeredBy.join(', ')
  return [
    `Rubric ${slice.rubric}, classifier ${slice.classifierVersion} (answered by ${answered})`,
    `  ${formatThresholds(slice)}`,
    `  Attempts: ${String(slice.attempts)}, provider failures ${ratio(slice.providerFailures)}` +
      formatCodes(slice),
    `  Judged: ${String(slice.judged)}`,
    `  Category agreement: ${ratio(slice.categoryAgreement)}`,
    ...slice.byCategory.map(formatCategory),
    ...formatDisagreements(slice),
    `  Priority agreement: ${ratio(slice.priorityAgreement)}`,
    ...slice.byPriority.map(formatPriority),
    ...formatPriorityDisagreements(slice),
    `  Uncertain priorities: ${ratio(slice.uncertainPriorities)}`,
    `  Review load: policy ${ratio(slice.reviewRate)}, the set expects ` +
      ratio(slice.expectedReviewRate),
    `  Handling agreement: ${ratio(slice.handlingAgreement)}`,
    ...formatCalibration(slice),
    `  Latency: ${formatLatency(slice.latency)}`,
    `  Tokens: ${formatTokens(slice.cost.tokens)}`,
    '  Cost in money: unavailable (no price per token is recorded in this repository)',
  ]
}

const formatThresholds = ({ rubric, thresholds }: QualitySlice) =>
  `Thresholds of ${rubric}: auto-accept ${decimals(thresholds.autoAccept)}, priority ` +
  `confidence ${decimals(thresholds.priorityConfidence)}, suspicion floor ` +
  decimals(thresholds.suspicionFloor)

const formatCodes = ({ failureCodes }: QualitySlice) =>
  failureCodes.length === 0
    ? ''
    : `: ${failureCodes.map(({ code, count }) => `${code} ${String(count)}`).join(', ')}`

const formatCategory = ({ category, expected, answered, agreed }: CategoryTally) =>
  `    ${category.padEnd(13)}expected ${String(expected)}, answered ${String(answered)}, ` +
  `agreed ${String(agreed)}`

const formatDisagreements = ({ disagreements }: QualitySlice) =>
  disagreements.map(
    ({ fixture, expected, answered }) =>
      `  Disagreed on ${fixture}: expected ${expected}, answered ${answered}`,
  )

const formatPriority = ({ priority, expected, answered, agreed }: PriorityTally) =>
  `    ${priority.padEnd(13)}expected ${String(expected)}, answered ${String(answered)}, ` +
  `agreed ${String(agreed)}`

const formatPriorityDisagreements = ({ priorityDisagreements }: QualitySlice) =>
  priorityDisagreements.map(
    ({ fixture, expected, answered }) =>
      `  Priority disagreed on ${fixture}: expected ${expected}, answered ${answered}`,
  )

/** The bins that hold something, and the error they add up to. */
function formatCalibration({ calibration }: QualitySlice): string[] {
  if (calibration.expectedCalibrationError === null) return ['  Calibration: nothing was judged']
  return [
    '  Calibration (confidence of the chosen category against agreement)',
    ...calibration.bins.map(formatBin),
    `    Expected calibration error: ${decimals(calibration.expectedCalibrationError)}`,
  ]
}

const formatBin = ({ from, to, judged, meanConfidence, agreement }: CalibrationBin) =>
  `    ${decimals(from, 1)}-${decimals(to, 1)}  judged ${String(judged)}, mean confidence ` +
  `${decimals(meanConfidence)}, agreement ${ratio(agreement)}`

const formatLatency = (latency: QualitySlice['latency']) =>
  latency.status === 'unavailable'
    ? unavailable(latency)
    : `median ${String(latency.medianMs)} ms, slowest ${String(latency.slowestMs)} ms, ` +
      `over ${String(latency.samples)} timed attempts`

const formatTokens = (tokens: QualitySlice['cost']['tokens']) =>
  tokens.status === 'unavailable'
    ? unavailable(tokens)
    : `${String(tokens.inputTokens)} in, ${String(tokens.outputTokens)} out, ` +
      `over ${String(tokens.samples)} answers`

/** Why a figure is missing, in words rather than in a code. */
const unavailable = (missing: Extract<Measured<unknown>, { status: 'unavailable' }>) =>
  missing.reason === 'not_measured'
    ? 'unavailable (nothing measured it)'
    : 'unavailable (no price per token is recorded in this repository)'
