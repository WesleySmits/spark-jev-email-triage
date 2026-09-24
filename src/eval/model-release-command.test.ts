import { describe, expect, it } from 'vitest'
import { jevModel } from '../jev/questions'
import { captureRunSnapshot } from './run-snapshot'
import { jevJudgment } from '../jev/fixtures'
import { reviewedCases } from './reviewed-set'
import type { QualityObservation } from './quality-report'
import {
  main,
  modelAt,
  modelGateExitCodes,
  modelReleaseEvidencePath,
  type ModelGateDependencies,
} from './model-release-command'

const declaration = (model: string) => `export const jevModel = '${model}'`

function execute(baseSource: string | null, file: unknown = null) {
  const lines: string[] = []
  const dependencies: ModelGateDependencies = {
    readBaseQuestions: () => baseSource,
    readEvidence: () => file,
  }
  const code = main(['--base', 'abc123'], (line) => lines.push(line), dependencies)
  return { code, output: lines.join('\n') }
}

function snapshot(classifier: string) {
  const observations: QualityObservation[] = reviewedCases.map((reviewed) => {
    const classification = jevJudgment(`thread-${reviewed.fixture}`, {
      category: reviewed.expectation.category,
      priority: reviewed.expectation.priority,
    })
    if (classification.status !== 'classified') throw new Error('Expected a synthetic answer')
    return {
      reviewed,
      classification: { ...classification, requestedModel: classifier, model: classifier },
      latencyMs: null,
    }
  })
  return captureRunSnapshot(observations, '2026-09-24T10:00:00Z')
}

const passingEvidence = {
  version: 1,
  fromClassifier: 'jev-1.12.0',
  toClassifier: jevModel,
  rubric: 'email-triage.v2',
  reviewerKind: 'human',
  reviewedBy: 'Release reviewer',
  reviewedOn: '2026-09-24',
  baseline: snapshot('jev-1.12.0'),
  candidate: snapshot(jevModel),
}

describe('pnpm eval:gate', () => {
  it('passes offline without evidence when the pinned classifier is unchanged', () => {
    expect(execute(declaration(jevModel))).toEqual({
      code: modelGateExitCodes.ok,
      output: `model release gate: unchanged (${jevModel}); no live evaluation was run`,
    })
  })

  it('fails closed when a model change has no reviewed evidence', () => {
    const result = execute(declaration('jev-1.12.0'))

    expect(result.code).toBe(modelGateExitCodes.failed)
    expect(result.output).toContain(modelReleaseEvidencePath('jev-1.12.0', jevModel))
  })

  it('passes a changed model only with matching evidence that meets the criterion', () => {
    expect(execute(declaration('jev-1.12.0'), passingEvidence)).toEqual({
      code: modelGateExitCodes.ok,
      output:
        `model release gate: passed jev-1.12.0 -> ${jevModel} using ` +
        modelReleaseEvidencePath('jev-1.12.0', jevModel),
    })
  })

  it('fails without echoing source or file contents when inputs cannot be read', () => {
    expect(execute(null)).toEqual({
      code: modelGateExitCodes.failed,
      output: 'model release gate: could not identify the base classifier',
    })
  })

  it('takes exactly one safe base revision', () => {
    const lines: string[] = []
    const dependencies: ModelGateDependencies = {
      readBaseQuestions: () => {
        throw new Error('must not read')
      },
      readEvidence: () => {
        throw new Error('must not read')
      },
    }

    expect(main(['--base', 'bad:ref'], (line) => lines.push(line), dependencies)).toBe(
      modelGateExitCodes.usage,
    )
    expect(lines).toEqual(['usage: pnpm eval:gate --base <git-revision>'])
  })
})

describe('modelAt', () => {
  it('reads only a pinned version declaration', () => {
    expect(modelAt(declaration('jev-1.13.0'))).toBe('jev-1.13.0')
    expect(modelAt("export const jevModel = 'jev-latest'")).toBeNull()
    expect(modelAt('no declaration')).toBeNull()
  })
})
