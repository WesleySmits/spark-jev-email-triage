import { describe, expect, it, vi } from 'vitest'
import type { SparkReadiness } from '../app/spark-readiness'
import { exitCodes, main } from './readback'

const ready: SparkReadiness = { status: 'ready' }

/** Runs the command against an answer the test controls. */
async function run(args: readonly string[], answer: SparkReadiness = ready) {
  const lines: string[] = []
  const probe = vi.fn(() => Promise.resolve(answer))
  const code = await main(args, (line) => lines.push(line), probe)
  return { code, output: lines.join('\n'), probe }
}

describe('pnpm readback:spark', () => {
  it('says Spark answers, and says nothing about mail', async () => {
    const { code, output } = await run([])
    expect(code).toBe(exitCodes.ok)
    expect(output).toBe('spark: ready')
  })

  it('reports a Spark that is not there as unavailable, with a coarse reason', async () => {
    const { code, output } = await run([], { status: 'unavailable', reason: 'missing' })
    expect(code).toBe(exitCodes.unavailable)
    expect(output).toBe('spark: unavailable (missing)')
  })

  it('reports every failure the probe can report, and only as those words', async () => {
    const reasons = ['missing', 'failed', 'malformed', 'local-only'] as const
    for (const reason of reasons) {
      const { code, output } = await run([], { status: 'unavailable', reason })
      expect(code).toBe(exitCodes.unavailable)
      expect(output).toBe(`spark: unavailable (${reason})`)
    }
  })

  it('takes no options, and asks Spark nothing when given one', async () => {
    const { code, output, probe } = await run(['--mailbox', 'someone@mail.example'])
    expect(code).toBe(exitCodes.usage)
    expect(output).toBe('usage: pnpm readback:spark')
    expect(probe).not.toHaveBeenCalled()
  })
})
