/**
 * The CI workflow read from its own source.
 *
 * A branch can require one check by name. That name is only worth requiring
 * while it still stands for every job CI runs, so the gate job's `needs` is
 * read here from the workflow file and checked against the jobs defined in
 * it, rather than trusted because a runbook says so. A job added without
 * being required fails the test that reads this.
 *
 * It parses only what that check needs — job names and their `needs` —
 * which is why no YAML parser is pulled in for it.
 */

/** The check a protected branch requires. It is a job id in the workflow. */
export const requiredCheck = 'required-checks'

/** The workflow the check lives in, from the repository root. */
export const workflowPath = '.github/workflows/ci.yml'

/** One job in the workflow, with the jobs it waits for. */
export type CiJob = Readonly<{ id: string; needs: readonly string[] }>

const jobsBlock = /^jobs:\s*$/
const topLevelKey = /^\S/
const jobId = /^ {2}([A-Za-z0-9_-]+):\s*$/
const inlineNeeds = /^ {4}needs:\s*\[([^\]]*)\]\s*$/

/** Every job the workflow defines, in the order it defines them. */
export function ciJobs(workflow: string): CiJob[] {
  const jobs: { id: string; needs: string[] }[] = []
  let inJobs = false
  for (const line of workflow.split('\n')) {
    if (jobsBlock.test(line)) {
      inJobs = true
    } else if (!inJobs) {
      continue
    } else if (topLevelKey.test(line)) {
      inJobs = false
    } else {
      collect(jobs, line)
    }
  }
  return jobs
}

/** Reads one line inside the jobs block: a new job, its `needs`, or neither. */
function collect(jobs: { id: string; needs: string[] }[], line: string): void {
  const started = jobId.exec(line)?.[1]
  if (started !== undefined) {
    jobs.push({ id: started, needs: [] })
    return
  }
  const needs = inlineNeeds.exec(line)?.[1]
  const current = jobs.at(-1)
  if (needs === undefined || current === undefined) return
  current.needs = needs
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name !== '')
}
