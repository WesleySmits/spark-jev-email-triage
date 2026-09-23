import { describe, expect, it } from 'vitest'
import { syntheticMailValues } from '../domain/fixtures'
import { jevFailure, jevJudgment } from '../jev/fixtures'
import { summarizeQuality, type QualityObservation } from './quality-report'
import { reviewedCases } from './reviewed-set'
import { captureRunSnapshot, replayRunSnapshot, runSnapshotSchema } from './run-snapshot'

const capturedAt = '2026-09-23T09:00:00.000Z'

const reviewedFor = (fixture: string) => {
  const found = reviewedCases.find((reviewed) => reviewed.fixture === fixture)
  if (found === undefined) throw new Error(`No reviewed case for ${fixture}`)
  return found
}

/** Every case answered, one of them not at all, and every call timed but one. */
const run = (): QualityObservation[] =>
  reviewedCases.map((reviewed, index) => ({
    reviewed,
    classification:
      index === 2
        ? jevFailure(`thread-${reviewed.fixture}`)
        : jevJudgment(`thread-${reviewed.fixture}`, {
            category: index % 3 === 0 ? 'personal' : reviewed.expectation.category,
            categoryShare: 0.7 + index / 50,
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

    expect(first).toMatchObject({
      fixture: reviewedCases[0]?.fixture,
      rubric: 'email-triage.v2',
      requestedModel: 'jev-1.13.0',
      latencyMs: 700,
      result: { status: 'classified', model: 'jev-1.13.0', usage: { inputTokens: 812 } },
    })
  })

  // A failure is kept as a failure, by its code alone.
  it('keeps a failed call as its content-free code, with no provider detail', () => {
    const failed = roundTrip(run()).entries[2]

    expect(failed?.result).toEqual({ status: 'provider_failure', errorCode: 'timeout' })
    expect(replayed(roundTrip(run()))[2]?.classification).toMatchObject({
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

    for (const value of syntheticMailValues) expect(written).not.toContain(value)
  })
})

describe('replayRunSnapshot', () => {
  it('refuses a case this build does not have', () => {
    const snapshot = roundTrip(run())
    const entries = [{ ...snapshot.entries[0], fixture: 'goneFromTheSet' }]

    expect(replayRunSnapshot(runSnapshotSchema.parse({ ...snapshot, entries }))).toEqual({
      status: 'refused',
      reason: 'unknown_fixture',
      fixture: 'goneFromTheSet',
      rubric: 'email-triage.v2',
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
      fixture: parsed.entries[0]?.fixture,
      rubric: 'email-triage.v1',
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
  it('refuses a file written to another shape', () => {
    const snapshot = roundTrip(run())

    expect(runSnapshotSchema.safeParse({ ...snapshot, version: 2 }).success).toBe(false)
  })

  it('refuses a failure code this build does not know', () => {
    const snapshot = roundTrip(run())
    const entries = [
      { ...snapshot.entries[2], result: { status: 'provider_failure', errorCode: 'teapot' } },
    ]

    expect(runSnapshotSchema.safeParse({ ...snapshot, entries }).success).toBe(false)
  })
})
