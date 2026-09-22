import { describe, expect, it } from 'vitest'
import {
  projectClassification,
  storedJudgmentSchema,
  type ClassificationLabels,
  type CurrentJudge,
  type StoredJudgment,
} from './stored-classification'
import { currentTriageRubric } from './triage'

const copy = { mailboxId: 'one@mail.example', messageId: '11' } as const

const judge: CurrentJudge = { rubric: currentTriageRubric, classifierVersion: 'jev-1.13.0' }

const labels: ClassificationLabels = {
  category: 'personal',
  priority: 'high',
  confidence: 0.91,
  priorityUncertain: false,
  review: 'auto_accepted',
  reviewPriority: 'normal',
}

type Overrides = Readonly<{
  subject?: Partial<StoredJudgment['subject']>
  threadLatestMessageId?: string
  judgedAt?: string
  verdict?: StoredJudgment['verdict']
}>

/** A stored judgment of the copy above, current unless an override says otherwise. */
function judgment({ subject, ...overrides }: Overrides = {}): StoredJudgment {
  return storedJudgmentSchema.parse({
    subject: { copy, threadId: '11', latestMessageId: '11', ...judge, ...subject },
    threadLatestMessageId: '11',
    judgedAt: '2026-09-20T09:00:00.000Z',
    verdict: { status: 'classified', labels },
    ...overrides,
  })
}

const failure = { status: 'provider_failure', errorCode: 'timeout' } as const

describe('projectClassification', () => {
  it('reads a judgment of the current version as current, naming the version it judged', () => {
    const stored = judgment()

    expect(projectClassification([stored], judge)).toEqual({
      state: 'current',
      subject: {
        copy,
        threadId: '11',
        latestMessageId: '11',
        rubric: currentTriageRubric,
        classifierVersion: 'jev-1.13.0',
      },
      judgedAt: '2026-09-20T09:00:00.000Z',
      labels,
    })
  })

  it('reads a judgment of an earlier message of the thread as stale', () => {
    const stored = judgment({ threadLatestMessageId: '13' })

    expect(projectClassification([stored], judge)).toMatchObject({
      state: 'stale',
      reason: 'newer_message',
      labels,
    })
  })

  it('reads a judgment made under another rubric as stale', () => {
    const stored = judgment({ subject: { rubric: 'email-triage.v1' } })

    expect(projectClassification([stored], judge)).toMatchObject({
      state: 'stale',
      reason: 'rubric',
    })
  })

  it('reads a judgment made by another classifier build as stale', () => {
    const stored = judgment({ subject: { classifierVersion: 'jev-1.12.0' } })

    expect(projectClassification([stored], judge)).toMatchObject({
      state: 'stale',
      reason: 'classifier',
    })
  })

  it('reports a failed attempt as its own state, with no category or priority', () => {
    const stored = judgment({ verdict: failure })

    expect(projectClassification([stored], judge)).toEqual({
      state: 'provider_failure',
      subject: stored.subject,
      judgedAt: stored.judgedAt,
      errorCode: 'timeout',
    })
  })

  it('keeps a stale classification when a retry for the newer version failed', () => {
    const stale = judgment({ threadLatestMessageId: '13' })
    const retried = judgment({
      subject: { latestMessageId: '13' },
      threadLatestMessageId: '13',
      judgedAt: '2026-09-21T09:00:00.000Z',
      verdict: failure,
    })

    expect(projectClassification([retried, stale], judge)).toMatchObject({
      state: 'stale',
      reason: 'newer_message',
      labels,
    })
  })

  it('ignores a failed attempt that no longer names the current version', () => {
    const stored = judgment({ subject: { rubric: 'email-triage.v1' }, verdict: failure })

    expect(projectClassification([stored], judge)).toEqual({ state: 'none' })
  })

  it('takes the newest classification when several name the current version', () => {
    const older = judgment({ subject: { threadId: '10' } })
    const newer = judgment({
      judgedAt: '2026-09-21T09:00:00.000Z',
      verdict: { status: 'classified', labels: { ...labels, category: 'purchase' } },
    })

    expect(projectClassification([older, newer], judge)).toMatchObject({
      state: 'current',
      labels: { category: 'purchase' },
    })
  })

  it('keeps the given order when two judgments were stored at the same moment', () => {
    const first = judgment({ subject: { threadId: '10' } })
    const second = judgment({
      verdict: { status: 'classified', labels: { ...labels, category: 'purchase' } },
    })

    expect(projectClassification([first, second], judge)).toMatchObject({
      subject: { threadId: '10' },
      labels: { category: 'personal' },
    })
  })

  it('reads a row with nothing stored as none, which is not a failure', () => {
    expect(projectClassification([], judge)).toEqual({ state: 'none' })
  })
})
