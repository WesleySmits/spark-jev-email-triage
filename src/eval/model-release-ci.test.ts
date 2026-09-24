import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const workflow = readFileSync('.github/workflows/ci.yml', 'utf8')
const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
  scripts?: Record<string, string>
}

describe('the offline model release gate in CI', () => {
  it('compares every pull request with its exact base commit', () => {
    expect(workflow).toContain('Gate classifier changes on reviewed offline evidence')
    expect(workflow).toContain('BASE_SHA: ${{ github.event.pull_request.base.sha }}')
    expect(workflow).toContain('run: pnpm eval:gate --base "$BASE_SHA"')
  })

  it('has a checked-in command and never runs the live evaluation', () => {
    expect(packageJson.scripts?.['eval:gate']).toBe('tsx src/eval/model-release-cli.ts')
    expect(workflow).not.toContain('eval:jev:live')
    expect(workflow).not.toContain('TYPESAFE_API_KEY')
  })
})
