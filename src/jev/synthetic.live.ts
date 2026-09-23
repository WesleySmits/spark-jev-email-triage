/**
 * Live Jev evaluation over the reviewed evaluation set. It never reads a real
 * mailbox and reports blocked when TYPESAFE_API_KEY is absent. What each
 * thread should come back as is written in `src/eval/reviewed-set.ts`, never
 * by this run. Agreement is reported, not asserted: the thresholds are not
 * calibrated yet.
 */
import { describe, expect, it } from 'vitest'
import {
  reviewedCases,
  reviewedMailboxAddress,
  reviewedThread,
  type ReviewedCase,
} from '../eval/reviewed-set'
import { handlingAgrees } from '../eval/handling-agreement'
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
    const rows = []
    // Serial, to stay well inside rate limits.
    for (const reviewed of reviewedCases) {
      const request = {
        thread: reviewedThread(reviewed),
        mailboxAddress: reviewedMailboxAddress,
      }
      rows.push(report(reviewed, await classify(request)))
    }
    // A provider failure is no judgment, so it is outside both figures.
    const judged = rows.filter((row) => row.handlingAgrees !== null)
    const onCategory = judged.filter((row) => row.category === row.expected).length
    const onHandling = judged.filter((row) => row.handlingAgrees === true).length
    console.table(rows)
    console.info(`Category agreement: ${String(onCategory)}/${String(judged.length)}`)
    console.info(`Handling agreement: ${String(onHandling)}/${String(judged.length)}`)

    expect(rows.map((row) => row.status)).not.toContain('provider_failure')
  })
})
