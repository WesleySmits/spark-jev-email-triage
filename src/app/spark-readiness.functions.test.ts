import { describe, expect, it } from 'vitest'
import { getSparkReadiness } from './spark-readiness.functions'

describe('readiness server function', () => {
  it('answers over GET, which carries no request data', () => {
    expect(getSparkReadiness.method).toBe('GET')
  })
})
