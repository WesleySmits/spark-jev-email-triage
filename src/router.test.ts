import { describe, expect, it } from 'vitest'
import { getRouter } from './router'

describe('getRouter', () => {
  it('registers the index route at the root path', () => {
    const router = getRouter()

    expect(router.routesByPath['/'].fullPath).toBe('/')
  })
})
