import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { jevJudgment } from '../jev/fixtures'
import { exitCodes, main } from './command'
import { reviewedCases } from './reviewed-set'
import { captureRunSnapshot, runSnapshotSchema, type RunSnapshot } from './run-snapshot'

const directory = mkdtempSync(join(tmpdir(), 'eval-report-'))

afterAll(() => {
  rmSync(directory, { recursive: true, force: true })
})

const snapshot = () =>
  captureRunSnapshot(
    reviewedCases.map((reviewed) => ({
      reviewed,
      classification: jevJudgment(`thread-${reviewed.fixture}`, {
        category: reviewed.expectation.category,
      }),
      latencyMs: 800,
    })),
    '2026-09-23T09:00:00.000Z',
  )

/** Writes a file this run owns and answers with its path. */
function written(name: string, contents: string): string {
  const path = join(directory, name)
  writeFileSync(path, contents)
  return path
}

const file = (name: string, value: RunSnapshot) =>
  written(name, JSON.stringify(runSnapshotSchema.parse(value)))

function run(args: readonly string[]) {
  const lines: string[] = []
  const code = main(args, (line) => lines.push(line))
  return { code, output: lines.join('\n') }
}

describe('pnpm eval:report', () => {
  it('counts a report from a snapshot, with no provider and no mailbox', () => {
    const { code, output } = run([file('good.json', snapshot())])

    expect(code).toBe(exitCodes.ok)
    expect(output).toContain('Triage quality on the reviewed evaluation set')
    expect(output).toContain('Rubric email-triage.v2, classifier jev-1.13.0')
    expect(output).toContain(`Observations: ${String(reviewedCases.length)}`)
  })

  it('says how it is called when it is called with nothing, or with too much', () => {
    for (const args of [[], ['one.json', 'two.json']]) {
      const { code, output } = run(args)

      expect(code).toBe(exitCodes.usage)
      expect(output).toBe('usage: pnpm eval:report <snapshot.json>')
    }
  })

  it('reports a snapshot it cannot read without guessing what was in it', () => {
    const { code, output } = run([join(directory, 'nothing-here.json')])

    expect(code).toBe(exitCodes.failed)
    expect(output).toBe('could not read that snapshot')
  })

  it('reports a file that is not a snapshot by its fields, never its values', () => {
    const { code, output } = run([written('other.json', '{"version":1,"entries":"lots"}')])

    expect(code).toBe(exitCodes.failed)
    expect(output).toContain('not a run snapshot')
    expect(output).toContain('entries')
    expect(output).not.toContain('lots')
  })

  // The report must not appear for a run this build cannot honestly count.
  it('refuses a run judged under a rubric this build no longer holds', () => {
    const taken = snapshot()
    const entries = taken.entries.map((entry) => ({ ...entry, rubric: 'email-triage.v1' }))
    const { code, output } = run([file('old-rubric.json', { ...taken, entries })])

    expect(code).toBe(exitCodes.failed)
    expect(output).toContain('refused unsupported_rubric')
    expect(output).not.toContain('email-triage.v1')
    expect(output).not.toContain('Triage quality')
  })
})
