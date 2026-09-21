import { describe, expect, it } from 'vitest'
import { readJevConfig } from './config'

describe('readJevConfig', () => {
  it('reads the API key from TYPESAFE_API_KEY', () => {
    expect(readJevConfig({ TYPESAFE_API_KEY: ' ts-synthetic-key ' })).toEqual({
      status: 'configured',
      apiKey: 'ts-synthetic-key',
    })
  })

  it.each([{}, { TYPESAFE_API_KEY: '' }, { TYPESAFE_API_KEY: '   ' }])(
    'reports missing credentials for %o',
    (env) => {
      expect(readJevConfig(env)).toEqual({ status: 'missing_credentials' })
    },
  )
})
