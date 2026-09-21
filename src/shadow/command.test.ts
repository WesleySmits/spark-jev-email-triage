import { describe, expect, it } from 'vitest'
import { exitCodes, formatSummary, main } from './command'
import type { ShadowSummary } from './pipeline'

const run = async (args: string[], env: NodeJS.ProcessEnv = {}) => {
  const lines: string[] = []
  const code = await main(args, env, (line) => lines.push(line))
  return { code, lines }
}

describe('shadow command', () => {
  it('runs the migration preflight on a disposable database', async () => {
    expect(await run(['--preflight'])).toEqual({
      code: exitCodes.ok,
      lines: ['preflight ok: schema 1'],
    })
  })

  it('reports invalid configuration by field, without values', async () => {
    const { code, lines } = await run([
      '--mailbox',
      'not an address',
      '--limit',
      '500',
      '--concurrency',
      'x',
    ])

    expect(code).toBe(exitCodes.usage)
    expect(lines).toEqual(['invalid configuration: mailbox, limit, jevConcurrency'])
  })

  it('is blocked before touching Spark when --apply has no API key', async () => {
    expect(
      await run(['--mailbox', 'support@example.com', '--apply'], { TYPESAFE_API_KEY: ' ' }),
    ).toEqual({
      code: exitCodes.blocked,
      lines: ['blocked: TYPESAFE_API_KEY is not set'],
    })
  })

  it('rejects unknown options', async () => {
    await expect(run(['--mailbox', 'support@example.com', '--archive'])).rejects.toThrow(
      /Unknown option/,
    )
  })
})

describe('formatSummary', () => {
  it('prints status and counts only', () => {
    const summary: ShadowSummary = {
      mode: 'apply',
      runId: 3,
      status: 'partial',
      errorCode: null,
      interruptedRuns: 0,
      wouldClassify: 0,
      listed: 4,
      skipped: 1,
      duplicates: 1,
      classified: 1,
      needsReview: 1,
      providerFailures: 1,
      readErrors: 0,
      storeErrors: 0,
      deferred: 0,
    }

    expect(formatSummary(summary)).toEqual([
      'mode: apply',
      'status: partial',
      'run: 3',
      'interruptedRuns: 0',
      'wouldClassify: 0',
      'listed: 4',
      'skipped: 1',
      'duplicates: 1',
      'classified: 1',
      'needsReview: 1',
      'providerFailures: 1',
      'readErrors: 0',
      'storeErrors: 0',
      'deferred: 0',
    ])
  })
})
