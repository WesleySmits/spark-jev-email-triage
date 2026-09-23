/**
 * Live Jev evaluation over the reviewed evaluation set. It never reads a real
 * mailbox and reports blocked when TYPESAFE_API_KEY is absent. What each
 * thread should come back as is written in `src/eval/reviewed-set.ts`, never
 * by this run. Agreement is reported, not asserted: the thresholds are not
 * calibrated yet.
 *
 * The run prints one row per case and then the quality report that
 * `src/eval/quality-report.ts` counts from the same answers: category
 * quality, the review rate, calibration and the provider-failure rate, split
 * by rubric and classifier build. This run times each call, so the report's
 * latency is measured here; nothing else in the repository measures it.
 */
import { describe, expect, it } from 'vitest'
import {
  reviewedCases,
  reviewedMailboxAddress,
  reviewedThread,
  type ReviewedCase,
} from '../eval/reviewed-set'
import { handlingAgrees } from '../eval/handling-agreement'
import { summarizeQuality, type QualityObservation } from '../eval/quality-report'
import { formatQualityReport } from '../eval/quality-report-text'
import { createJevClassifier, type JevClassification } from './classifier'
import { apiKeyVariable, readJevConfig } from './config'
import { resolveClassification } from './policy'
import { createSdkTransport } from './transport'

const provenance = (classification: JevClassification) =>
  classification.status === 'classified'
    ? { model: classification.model, inputTokens: classification.usage.inputTokens }
    : { failure: classification.failure.code }

function labels(reviewed: ReviewedCase, classification: JevClassification) {
  const outcome = resolveClassification(classification)
  const agrees = handlingAgrees(reviewed.expectation, outcome)
  if (outcome.status !== 'classified') return { review: outcome.review, handlingAgrees: agrees }
  return {
    category: outcome.category,
    confidence: Number(outcome.confidence.toFixed(3)),
    priority: outcome.priority,
    review: outcome.review,
    handlingAgrees: agrees,
    reviewPriority: outcome.reviewPriority,
    suspicion: outcome.suspicionSignals.join(', '),
  }
}

const report = (reviewed: ReviewedCase, classification: JevClassification) => ({
  fixture: reviewed.fixture,
  expected: reviewed.expectation.category,
  expectedPriority: reviewed.expectation.priority,
  expectedHandling: reviewed.expectation.handling,
  status: classification.status,
  ...provenance(classification),
  ...labels(reviewed, classification),
})

const config = readJevConfig(process.env)
const blocked = config.status === 'missing_credentials'

describe('Jev on the reviewed evaluation set (live)', () => {
  const title = blocked
    ? `BLOCKED: ${apiKeyVariable} is not set`
    : 'classifies every reviewed thread with a valid response'

  it.skipIf(blocked)(title, async () => {
    if (config.status !== 'configured') return
    const classify = createJevClassifier(createSdkTransport({ apiKey: config.apiKey }))
    const observations: QualityObservation[] = []
    // Serial, to stay well inside rate limits.
    for (const reviewed of reviewedCases) {
      const request = {
        thread: reviewedThread(reviewed),
        mailboxAddress: reviewedMailboxAddress,
      }
      // The wall clock around the call, which is the only latency anything
      // here measures. It includes this process and the network, not just
      // the provider's own time.
      const startedAt = performance.now()
      const classification = await classify(request)
      const latencyMs = Math.round(performance.now() - startedAt)
      observations.push({ reviewed, classification, latencyMs })
    }
    console.table(
      observations.map(({ reviewed, classification }) => report(reviewed, classification)),
    )
    console.info(formatQualityReport(summarizeQuality(observations)))

    expect(observations.map(({ classification }) => classification.status)).not.toContain(
      'provider_failure',
    )
  })
})
