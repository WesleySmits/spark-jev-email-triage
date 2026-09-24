/** Offline CI command for the model release gate. */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { jevModel } from '../jev/questions'
import {
  assessModelRelease,
  modelReleaseEvidenceSchema,
  type ModelReleaseEvidence,
} from './model-release-gate'

export const modelGateExitCodes = { ok: 0, failed: 1, usage: 64 } as const

const usage = 'usage: pnpm eval:gate --base <git-revision>'
const safeRevision = /^[A-Za-z0-9][A-Za-z0-9_./-]*$/
const modelDeclaration = /export const jevModel = ['"](jev-\d{1,3}\.\d{1,3}\.\d{1,3})['"]/

export interface ModelGateDependencies {
  readBaseQuestions(revision: string): string | null
  readEvidence(path: string): unknown
}

const dependencies: ModelGateDependencies = {
  readBaseQuestions: (revision) => {
    try {
      return execFileSync('git', ['show', `${revision}:src/jev/questions.ts`], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      })
    } catch {
      return null
    }
  },
  readEvidence: (path) => {
    try {
      const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
      return parsed
    } catch {
      return null
    }
  },
}

export function modelReleaseEvidencePath(fromClassifier: string, toClassifier: string): string {
  return `src/eval/evidence/${fromClassifier}--${toClassifier}.json`
}

export function modelAt(source: string): string | null {
  return modelDeclaration.exec(source)?.[1] ?? null
}

export function main(
  args: readonly string[],
  print: (line: string) => void,
  injected: ModelGateDependencies = dependencies,
): number {
  const [flag, revision, ...rest] = args
  if (
    flag !== '--base' ||
    revision === undefined ||
    rest.length > 0 ||
    !safeRevision.test(revision)
  ) {
    print(usage)
    return modelGateExitCodes.usage
  }
  const source = injected.readBaseQuestions(revision)
  const fromClassifier = source === null ? null : modelAt(source)
  if (fromClassifier === null) {
    print('model release gate: could not identify the base classifier')
    return modelGateExitCodes.failed
  }
  if (fromClassifier === jevModel) {
    print(`model release gate: unchanged (${jevModel}); no live evaluation was run`)
    return modelGateExitCodes.ok
  }
  const path = modelReleaseEvidencePath(fromClassifier, jevModel)
  const parsed = evidenceAt(path, injected)
  if (parsed === null) {
    print(`model release gate: missing or invalid reviewed evidence at ${path}`)
    return modelGateExitCodes.failed
  }
  const assessment = assessModelRelease(parsed, fromClassifier, jevModel)
  if (assessment.status === 'failed') {
    print(`model release gate: failed (${assessment.failures.join(', ')})`)
    return modelGateExitCodes.failed
  }
  print(`model release gate: passed ${fromClassifier} -> ${jevModel} using ${path}`)
  return modelGateExitCodes.ok
}

function evidenceAt(path: string, injected: ModelGateDependencies): ModelReleaseEvidence | null {
  const file = injected.readEvidence(path)
  const parsed = modelReleaseEvidenceSchema.safeParse(file)
  return parsed.success ? parsed.data : null
}
