import { describe, expect, it } from 'vitest'
import { sparkMessageLink } from './message-link'

describe('sparkMessageLink', () => {
  it('claims no way to open one exact message in Spark', () => {
    expect(sparkMessageLink).toEqual({ available: false, reason: 'unproven' })
  })
})
