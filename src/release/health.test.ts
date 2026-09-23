import { describe, expect, it } from 'vitest'
import { commitVariable, healthFor, healthStatusCode } from './health'
import { healthResponse } from './health.server'

const commit = '771bb2bef1f84c4c5a347e2048eb0a284165ac53'

describe('health', () => {
  it('names the commit a build was made from', () => {
    expect(healthFor(commit)).toStrictEqual({ status: 'ok', commit })
  })

  it('reports a build with no commit as unidentified, never as ok', () => {
    expect(healthFor(undefined)).toStrictEqual({ status: 'unidentified', reason: 'unset' })
    expect(healthFor('  ')).toStrictEqual({ status: 'unidentified', reason: 'unset' })
  })

  it('refuses anything that is not a full commit, without repeating it', () => {
    const answer = healthFor('771bb2b')
    expect(answer).toStrictEqual({ status: 'unidentified', reason: 'malformed' })
    expect(JSON.stringify(answer)).not.toContain('771bb2b')
  })

  it('refuses an abbreviated or tag-like name, so only proof counts', () => {
    expect(healthFor('v1.4.0').status).toBe('unidentified')
    expect(healthFor(`${commit}-dirty`).status).toBe('unidentified')
    expect(healthFor(commit.toUpperCase()).status).toBe('unidentified')
  })

  it('is unhealthy while the deployed commit is unknown', () => {
    expect(healthStatusCode(healthFor(commit))).toBe(200)
    expect(healthStatusCode(healthFor(undefined))).toBe(503)
  })
})

describe('health endpoint', () => {
  it('answers with the commit, uncached, as JSON', async () => {
    const response = healthResponse({ [commitVariable]: commit })
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8')
    expect(await response.json()).toStrictEqual({ status: 'ok', commit })
  })

  it('reads nothing but the commit, so no configuration can leak', async () => {
    const response = healthResponse({
      [commitVariable]: commit,
      TYPESAFE_API_KEY: 'secret-key',
      SHADOW_DATABASE_PATH: '/home/someone/.data/shadow-triage.sqlite',
    })
    const body = await response.text()
    expect(body).not.toContain('secret-key')
    expect(body).not.toContain('shadow-triage')
    expect(JSON.parse(body)).toStrictEqual({ status: 'ok', commit })
  })

  it('serves 503 for a build it cannot identify', async () => {
    const response = healthResponse({})
    expect(response.status).toBe(503)
    expect(await response.json()).toStrictEqual({ status: 'unidentified', reason: 'unset' })
  })
})
