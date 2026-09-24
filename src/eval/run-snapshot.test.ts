import { describe, expect, it } from 'vitest'
import { jevFailure, jevJudgment } from '../jev/fixtures'
import { evaluationMailValues } from './fixtures'
import { summarizeQuality, type QualityObservation } from './quality-report'
import { reviewedCases, type ReviewedCase, type ReviewedExpectation } from './reviewed-set'
import { captureRunSnapshot, replayRunSnapshot, runSnapshotSchema } from './run-snapshot'

const capturedAt = '2026-09-23T09:00:00.000Z'

const caseOf = (cases: readonly ReviewedCase[], fixture: string) => {
  const found = cases.find((reviewed) => reviewed.fixture === fixture)
  if (found === undefined) throw new Error(`No reviewed case for ${fixture}`)
  return found
}

const reviewedFor = (fixture: string) => caseOf(reviewedCases, fixture)

/**
 * The set as it would read after a reviewer re-read one case and settled on
 * other labels. Only the labels move: the thread, its digest and every
 * message id stay exactly as the run measured them.
 */
function correcting(fixture: string, corrected: Partial<ReviewedExpectation>): ReviewedCase[] {
  const cases = reviewedCases.map((reviewed) =>
    reviewed.fixture === fixture
      ? { ...reviewed, expectation: { ...reviewed.expectation, ...corrected } }
      : reviewed,
  )

  expect(caseOf(cases, fixture).writtenAgainst).toEqual(reviewedFor(fixture).writtenAgainst)
  return cases
}

/** Every case answered, one of them not at all, and every call timed but one. */
const run = (): QualityObservation[] =>
  reviewedCases.map((reviewed, index) => ({
    reviewed,
    classification:
      reviewed.fixture === 'suspicious'
        ? jevFailure(`thread-${reviewed.fixture}`)
        : jevJudgment(`thread-${reviewed.fixture}`, {
            category: index % 3 === 0 ? 'personal' : reviewed.expectation.category,
            categoryShare: Math.min(0.99, 0.7 + index / 50),
          }),
    latencyMs: index === 1 ? null : 700 + index * 30,
  }))

/** The snapshot as it would be read back from a file. */
const roundTrip = (observations: readonly QualityObservation[]) =>
  runSnapshotSchema.parse(JSON.parse(JSON.stringify(captureRunSnapshot(observations, capturedAt))))

const replayed = (snapshot: ReturnType<typeof roundTrip>) => {
  const replay = replayRunSnapshot(snapshot)
  if (replay.status !== 'replayed') throw new Error(`Refused: ${replay.reason}`)
  return replay.observations
}

describe('a run snapshot', () => {
  // The whole point: a report nobody can recount is a claim, not evidence.
  it('counts the very same report after a round trip through a file', () => {
    const observations = run()

    expect(summarizeQuality(replayed(roundTrip(observations)))).toEqual(
      summarizeQuality(observations),
    )
  })

  it('keeps every answer, the tokens it cost and the time it took', () => {
    const [first] = roundTrip(run()).entries
    const measured = reviewedFor('customerQuestion')

    expect(first).toMatchObject({
      fixture: measured.fixture,
      threadDigest: measured.writtenAgainst.threadDigest,
      rubric: 'email-triage.v2',
      requestedModel: 'jev-1.13.0',
      latencyMs: 700,
      result: { status: 'classified', model: 'jev-1.13.0', usage: { inputTokens: 812 } },
    })
  })

  // The labels a figure is counted against, and not the prose that argued
  // for them: a snapshot carries no writing about mail.
  it('keeps the labels the run was measured against, and none of their argument', () => {
    const [first] = roundTrip(run()).entries
    const { expectation } = reviewedFor('customerQuestion')

    expect(first?.expectation).toEqual({
      category: expectation.category,
      priority: expectation.priority,
      handling: expectation.handling,
    })
    expect(first?.expectation).not.toHaveProperty('rationale')
  })

  // A failure is kept as a failure, by its code alone.
  it('keeps a failed call as its content-free code, with no provider detail', () => {
    const snapshot = roundTrip(run())
    const failed = snapshot.entries.find(({ fixture }) => fixture === 'suspicious')
    const replayedFailure = replayed(snapshot).find(
      ({ reviewed }) => reviewed.fixture === 'suspicious',
    )

    expect(failed?.result).toEqual({ status: 'provider_failure', errorCode: 'timeout' })
    expect(replayedFailure?.classification).toMatchObject({
      status: 'provider_failure',
      failure: { code: 'timeout', detail: null, httpStatus: null },
    })
  })

  it('says where nothing timed a call rather than inventing a time', () => {
    expect(roundTrip(run()).entries[1]?.latencyMs).toBeNull()
    expect(replayed(roundTrip(run()))[1]?.latencyMs).toBeNull()
  })

  // A snapshot is written to be shared, so the mail stays in the repository
  // and only its name travels.
  it('carries no subject, body, address, name or attachment from the mail it measures', () => {
    const written = JSON.stringify(roundTrip(run()))

    for (const value of evaluationMailValues) expect(written).not.toContain(value)
  })
})

describe('replayRunSnapshot', () => {
  it('refuses a case this build does not have', () => {
    const snapshot = roundTrip(run())
    const entries = [{ ...snapshot.entries[0], fixture: 'goneFromTheSet' }]

    expect(replayRunSnapshot(runSnapshotSchema.parse({ ...snapshot, entries }))).toEqual({
      status: 'refused',
      reason: 'unknown_fixture',
    })
  })

  // The answers describe the mail that was measured. If that mail has
  // changed since, they describe something this build no longer holds.
  it('refuses a case whose labelled thread has changed since the run', () => {
    const snapshot = roundTrip(run())
    const entries = [{ ...snapshot.entries[0], threadDigest: '0000000000000000' }]
    const replay = replayRunSnapshot(runSnapshotSchema.parse({ ...snapshot, entries }))

    expect(replay).toMatchObject({ status: 'refused', reason: 'changed_fixture' })
  })

  // Reading a case again and correcting its labels is an ordinary outcome
  // here, and it leaves the thread, the digest and every message id alone.
  // The answers would then be counted against labels nobody had written when
  // the run happened.
  it.each([
    { field: 'category', corrected: { category: 'other' } },
    { field: 'priority', corrected: { priority: 'low' } },
    { field: 'handling', corrected: { handling: 'needs_person' } },
  ] as const)('refuses a run whose expected $field was corrected since', ({ corrected }) => {
    const snapshot = roundTrip(run())
    const cases = correcting('invoice', corrected)

    expect(replayRunSnapshot(snapshot, cases)).toEqual({
      status: 'refused',
      reason: 'changed_expectation',
    })
  })

  // What the refusal above is for: the same answers, counted against
  // corrected labels, are a different report.
  it('would otherwise have counted another report from the very same answers', () => {
    const observations = run()
    const corrected = correcting('invoice', { category: 'other' })
    const against = observations.map((observation) => ({
      ...observation,
      reviewed: caseOf(corrected, observation.reviewed.fixture),
    }))

    expect(summarizeQuality(against)).not.toEqual(summarizeQuality(observations))
  })

  it('replays a run whose expectation is still the one it was measured against', () => {
    const snapshot = roundTrip(run())

    expect(replayRunSnapshot(snapshot, correcting('invoice', {})).status).toBe('replayed')
  })

  // Old rubric ids stay parseable on purpose, so a run naming one reads back
  // fine. Counting it would apply today's policy and today's thresholds to
  // judgments made under other meanings.
  it('refuses a run judged under a rubric this build no longer holds', () => {
    const snapshot = roundTrip(run())
    const entries = [{ ...snapshot.entries[0], rubric: 'email-triage.v1' }]
    const parsed = runSnapshotSchema.parse({ ...snapshot, entries })

    expect(replayRunSnapshot(parsed)).toEqual({
      status: 'refused',
      reason: 'unsupported_rubric',
    })
  })

  // A report over what is left would be another run's report under this
  // one's name.
  it('refuses the whole run when one entry cannot be counted', () => {
    const snapshot = roundTrip(run())
    const entries = snapshot.entries.map((entry, index) =>
      index === 4 ? { ...entry, rubric: 'email-triage.v1' } : entry,
    )

    expect(replayRunSnapshot(runSnapshotSchema.parse({ ...snapshot, entries }))).toMatchObject({
      status: 'refused',
      reason: 'unsupported_rubric',
    })
  })

  it('replays a case against the set it names, not against a case beside it', () => {
    const snapshot = roundTrip([
      {
        reviewed: reviewedFor('invoice'),
        classification: jevJudgment('thread-invoice', { category: 'purchase' }),
        latencyMs: 500,
      },
    ])

    expect(replayed(snapshot)[0]?.reviewed.fixture).toBe('invoice')
  })
})

describe('runSnapshotSchema', () => {
  // A version 1 file carried no expectation, so recounting one would count
  // its answers against whatever the set says today.
  it('refuses a file written to an older shape, rather than recounting it', () => {
    const snapshot = roundTrip(run())

    expect(runSnapshotSchema.safeParse({ ...snapshot, version: 1 }).success).toBe(false)
    expect(runSnapshotSchema.safeParse({ ...snapshot, version: 3 }).success).toBe(false)
  })

  it('refuses an entry that does not say what it was measured against', () => {
    const snapshot = roundTrip(run())
    const [first] = snapshot.entries
    if (first === undefined) throw new Error('Expected an entry')
    const { expectation, ...withoutExpectation } = first

    expect(expectation.category).toBeDefined()
    expect(
      runSnapshotSchema.safeParse({ ...snapshot, entries: [withoutExpectation] }).success,
    ).toBe(false)
  })

  it('refuses a failure code this build does not know', () => {
    const snapshot = roundTrip(run())
    const entries = [
      { ...snapshot.entries[2], result: { status: 'provider_failure', errorCode: 'teapot' } },
    ]

    expect(runSnapshotSchema.safeParse({ ...snapshot, entries }).success).toBe(false)
  })
})
