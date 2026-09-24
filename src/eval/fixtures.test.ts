import { describe, expect, it } from 'vitest'
import { threadSchema } from '../domain/email'
import { evaluationThreads, featureEightThreads } from './fixtures'

const threads = Object.values(evaluationThreads).map((evaluated) => threadSchema.parse(evaluated))
const featureEight = Object.values(featureEightThreads).map((evaluated) =>
  threadSchema.parse(evaluated),
)
const reservedDomain = /(^|\.)(example\.(com|org|net)|example|test|invalid)$/

describe('Feature 8 evaluation fixtures', () => {
  it('parse as distinct thread snapshots', () => {
    expect(new Set(threads.map(({ id }) => id)).size).toBe(threads.length)
  })

  it('use reserved domains only', () => {
    const domains = featureEight.flatMap((evaluated) =>
      evaluated.messages.flatMap((item) =>
        [item.from, ...item.to, ...item.cc].map(({ address }) => address.split('@')[1]),
      ),
    )

    for (const domain of domains) expect(domain).toMatch(reservedDomain)
  })

  it('duplicates a provider message id only for the two alias copies', () => {
    const ids = featureEight.flatMap(({ messages }) => messages.map(({ id }) => id))
    const repeated = ids.filter((id, index) => ids.indexOf(id) !== index)

    expect(repeated).toEqual(['msg-alias-notice'])
  })
})
