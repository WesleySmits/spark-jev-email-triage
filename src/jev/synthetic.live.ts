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
 *
 * It also writes the run down, because a run reaches the provider once and a
 * printed report is a claim nobody else can check. The snapshot holds the
 * answers this run received and no mail at all, and `pnpm eval:report` counts
 * the same figures from it offline. It is written under `.data/`, which Git
 * ignores, so a live answer is never committed; the file name is this run's
 * own UTC timestamp, so no argument or environment variable decides where
 * anything is written.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
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
import { captureRunSnapshot } from '../eval/run-snapshot'
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

/** Git ignores `.data/`, so a live answer never reaches a commit. */
const snapshotDirectory = '.data'

/**
 * Writes the run down and answers with the path. The name is the run's own
 * timestamp with its colons replaced, so nothing outside this file decides
 * where anything is written.
 */
function writeSnapshot(observations: readonly QualityObservation[]): string {
  const capturedAt = new Date().toISOString()
  const path = join(snapshotDirectory, `eval-run-${capturedAt.replaceAll(':', '-')}.json`)
  mkdirSync(snapshotDirectory, { recursive: true })
  writeFileSync(path, `${JSON.stringify(captureRunSnapshot(observations, capturedAt), null, 2)}\n`)
  return path
}

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
    console.info(`Run written to ${writeSnapshot(observations)}; recount it with pnpm eval:report`)

    expect(observations.map(({ classification }) => classification.status)).not.toContain(
      'provider_failure',
    )
  })
})
