/**
 * Live Jev evaluation over synthetic fixtures only. It never reads a real
 * mailbox and reports blocked when TYPESAFE_API_KEY is absent. Agreement is
 * reported, not asserted: thresholds are not calibrated yet.
 */
import { describe, expect, it } from 'vitest'
import type { z } from 'zod'
import { threadSchema } from '../domain/email'
import { syntheticThreads } from '../domain/fixtures'
import type { categorySchema } from '../domain/triage'
import { createJevClassifier, type JevClassification } from './classifier'
import { apiKeyVariable, readJevConfig } from './config'
import { resolveClassification } from './policy'
import { createSdkTransport } from './transport'

type FixtureName = keyof typeof syntheticThreads

const expectedCategory: Record<FixtureName, z.infer<typeof categorySchema>> = {
  customerQuestion: 'customer_request',
  invoice: 'billing',
  systemAlert: 'system_alert',
  newsletter: 'newsletter',
  coldSales: 'sales_outreach',
  suspicious: 'suspicious',
  promptInjection: 'suspicious',
  ambiguous: 'other',
  multiMessage: 'customer_request',
}

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

const report = (name: FixtureName, classification: JevClassification) => ({
  fixture: name,
  expected: expectedCategory[name],
  status: classification.status,
  ...provenance(classification),
  ...labels(classification),
})

const config = readJevConfig(process.env)
const blocked = config.status === 'missing_credentials'

describe('Jev on synthetic fixtures (live)', () => {
  const title = blocked
    ? `BLOCKED: ${apiKeyVariable} is not set`
    : 'classifies every synthetic thread with a valid response'

  it.skipIf(blocked)(title, async () => {
    if (config.status !== 'configured') return
    const classify = createJevClassifier(createSdkTransport({ apiKey: config.apiKey }))
    const rows = []
    // Serial, to stay well inside rate limits.
    for (const name of Object.keys(expectedCategory) as FixtureName[]) {
      const thread = threadSchema.parse(syntheticThreads[name])
      rows.push(report(name, await classify({ thread, mailboxAddress: 'inbox@example.com' })))
    }
    const agreed = rows.filter((row) => row.category === row.expected).length
    console.table(rows)
    console.info(`Category agreement: ${String(agreed)}/${String(rows.length)}`)

    expect(rows.map((row) => row.status)).not.toContain('provider_failure')
  })
})
