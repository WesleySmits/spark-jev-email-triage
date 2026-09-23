/**
 * Live Jev evaluation over the candidate evaluation set. It never reads a
 * real mailbox and reports blocked when TYPESAFE_API_KEY is absent. What each
 * thread should come back as is written in `src/eval/candidate-set.ts`, never
 * by this run. Agreement is reported, not asserted: the expectations there
 * still await a person, and the thresholds are not calibrated yet.
 */
import { describe, expect, it } from 'vitest'
import {
  candidateCases,
  candidateMailboxAddress,
  candidateThread,
  type CandidateCase,
} from '../eval/candidate-set'
import { createJevClassifier, type JevClassification } from './classifier'
import { apiKeyVariable, readJevConfig } from './config'
import { resolveClassification } from './policy'
import { createSdkTransport } from './transport'

const provenance = (classification: JevClassification) =>
  classification.status === 'classified'
    ? { model: classification.model, inputTokens: classification.usage.inputTokens }
    : { failure: classification.failure.code }

function labels(classification: JevClassification) {
  const outcome = resolveClassification(classification)
  if (outcome.status !== 'classified') return { review: outcome.review }
  return {
    category: outcome.category,
    confidence: Number(outcome.confidence.toFixed(3)),
    priority: outcome.priority,
    review: outcome.review,
    reviewPriority: outcome.reviewPriority,
    suspicion: outcome.suspicionSignals.join(', '),
  }
}

const report = (candidate: CandidateCase, classification: JevClassification) => ({
  fixture: candidate.fixture,
  expected: candidate.expectation.category,
  expectedPriority: candidate.expectation.priority,
  expectedHandling: candidate.expectation.handling,
  status: classification.status,
  ...provenance(classification),
  ...labels(classification),
})

const config = readJevConfig(process.env)
const blocked = config.status === 'missing_credentials'

describe('Jev on the candidate evaluation set (live)', () => {
  const title = blocked
    ? `BLOCKED: ${apiKeyVariable} is not set`
    : 'classifies every candidate thread with a valid response'

  it.skipIf(blocked)(title, async () => {
    if (config.status !== 'configured') return
    const classify = createJevClassifier(createSdkTransport({ apiKey: config.apiKey }))
    const rows = []
    // Serial, to stay well inside rate limits.
    for (const candidate of candidateCases) {
      const request = {
        thread: candidateThread(candidate),
        mailboxAddress: candidateMailboxAddress,
      }
      rows.push(report(candidate, await classify(request)))
    }
    const agreed = rows.filter((row) => row.category === row.expected).length
    console.table(rows)
    console.info(`Category agreement: ${String(agreed)}/${String(rows.length)}`)

    expect(rows.map((row) => row.status)).not.toContain('provider_failure')
  })
})
