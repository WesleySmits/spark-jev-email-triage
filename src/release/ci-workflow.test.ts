import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ciJobs, requiredCheck, workflowPath } from './ci-workflow'

const workflow = readFileSync(workflowPath, 'utf8')
const jobs = ciJobs(workflow)
const gate = jobs.find((job) => job.id === requiredCheck)

describe('the required check', () => {
  it('is a job CI runs, so a branch can require it by name', () => {
    expect(gate).toBeDefined()
    expect(jobs.length).toBeGreaterThan(1)
  })

  it('waits for every other job, so nothing CI runs stops being required', () => {
    const others = jobs.filter((job) => job.id !== requiredCheck).map((job) => job.id)
    expect(gate?.needs).toStrictEqual(others)
  })

  it('runs even when a job it waits for failed, so the check reports', () => {
    expect(workflow).toContain(`  ${requiredCheck}:\n    if: always()\n`)
  })

  it('fails unless every job it waits for succeeded', () => {
    expect(workflow).toContain('test "$result" = success')
  })

  it('runs on every pull request, whatever branch it targets', () => {
    expect(workflow).toContain('on:\n  pull_request:\n')
  })
})

describe('the runbook', () => {
  const runbook = readFileSync('docs/runbook.md', 'utf8')

  it('names the check that is actually required, so the two cannot drift', () => {
    expect(runbook).toContain(requiredCheck)
    expect(runbook).toContain(workflowPath)
  })
})

describe('reading the workflow', () => {
  it('reads a job and what it waits for', () => {
    const jobs = ciJobs(
      ['jobs:', '  build:', '    runs-on: x', '  gate:', '    needs: [build]'].join('\n'),
    )
    expect(jobs).toStrictEqual([
      { id: 'build', needs: [] },
      { id: 'gate', needs: ['build'] },
    ])
  })

  it('reads nothing outside the jobs block', () => {
    expect(
      ciJobs(['on:', '  pull_request:', 'jobs:', '  build:', 'permissions:'].join('\n')),
    ).toStrictEqual([{ id: 'build', needs: [] }])
  })

  it('reads a comment as neither a job nor a need', () => {
    expect(ciJobs(['jobs:', '  # needs: [nothing]', '  build:'].join('\n'))).toStrictEqual([
      { id: 'build', needs: [] },
    ])
  })
})
