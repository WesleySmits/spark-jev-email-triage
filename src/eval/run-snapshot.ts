/**
 * One evaluation run, written down so the exact report can be counted again
 * without the provider.
 *
 * A report is only worth as much as what it can be checked against. The live
 * run is the one thing here that reaches Jev, it cannot be repeated — another
 * run is another run — and a printed report is a claim nobody else can
 * recompute. A snapshot is what makes it evidence: the answers that run
 * received, kept exactly as they were validated, so `replayRunSnapshot` and
 * `summarizeQuality` give the same figures on any machine, offline, forever.
 *
 * What it holds, and what it deliberately does not:
 *
 * - The mail is named, never copied. An entry carries the fixture's name and
 *   the digest of the thread it was measured against, and the mail itself
 *   stays in `src/domain/fixtures.ts` where a person already reviewed it. So
 *   no subject, address, body or attachment can travel in a snapshot, and a
 *   replay still fails loudly when the labelled thread has changed since:
 *   the digest is recomputed from the thread this build holds and compared
 *   with the one the run measured.
 * - The classifier's answers travel whole, because they are what the figures
 *   are counted from: the chosen labels, every probability, and the
 *   provider's own token usage. They are numbers and rubric labels, and no
 *   part of them is mail.
 * - A failed call keeps its content-free code and nothing else. A provider's
 *   own detail — a schema path, an HTTP status, a message it wrote — is not
 *   kept: the report counts failures by code, and a detail is the one field
 *   that could carry provider text into a file meant to be shared.
 * - Latency travels as measured, or as `null` where nothing measured it.
 *
 * A snapshot is read back as data, never trusted as code: every field is
 * parsed, and a run this build cannot honestly count is refused. That
 * includes a rubric this build no longer holds — old ids stay parseable on
 * purpose, and counting such a run under today's policy and thresholds would
 * be exactly the misreading `quality-report.ts` refuses to print.
 */
import { z } from 'zod'
import type { JevClassification } from '../jev/classifier'
import { jevErrorCodes } from '../jev/errors'
import { triageResponseSchema } from '../jev/response'
import { isReportableRubric, type QualityObservation } from './quality-report'
import { reviewedCases, reviewedThread, type ReviewedCase } from './reviewed-set'
import { threadDigest } from './thread-digest'

const name = z.string().trim().min(1)

/** What one call to the classifier returned, as the run validated it. */
const resultSchema = z.discriminatedUnion('status', [
  z.strictObject({
    status: z.literal('classified'),
    /** The versioned model that answered, which may differ from the request. */
    model: name,
    usage: z.strictObject({
      inputTokens: z.int().nonnegative(),
      outputTokens: z.int().nonnegative(),
    }),
    answers: triageResponseSchema.shape.answers,
  }),
  z.strictObject({
    status: z.literal('provider_failure'),
    /** The code alone. A provider's own detail never enters a snapshot. */
    errorCode: z.enum(jevErrorCodes),
  }),
])

const entrySchema = z.strictObject({
  /** The reviewed case, by name. The mail itself stays in the repository. */
  fixture: name,
  /** The digest of the thread that case was measured against. */
  threadDigest: name,
  /** The rubric the classifier judged under. */
  rubric: name,
  /** The pinned classifier build that was asked. */
  requestedModel: name,
  /** Wall-clock milliseconds of the call, or `null` where nothing timed it. */
  latencyMs: z.number().nonnegative().nullable(),
  result: resultSchema,
})

export const runSnapshotSchema = z.strictObject({
  /** Bumped when the shape changes, so an older file is refused, not misread. */
  version: z.literal(1),
  /** When the run was taken. It names no mailbox and no person. */
  capturedAt: z.iso.datetime({ offset: true }),
  entries: z.array(entrySchema),
})

export type RunSnapshot = z.infer<typeof runSnapshotSchema>

/** One run, written down. Nothing is computed here that was not observed. */
export function captureRunSnapshot(
  observations: readonly QualityObservation[],
  capturedAt: string,
): RunSnapshot {
  return {
    version: 1,
    capturedAt,
    entries: observations.map(({ reviewed, classification, latencyMs }) => ({
      fixture: reviewed.fixture,
      threadDigest: reviewed.writtenAgainst.threadDigest,
      rubric: classification.rubric,
      requestedModel: classification.requestedModel,
      latencyMs,
      result:
        classification.status === 'classified'
          ? {
              status: 'classified' as const,
              model: classification.model,
              usage: classification.usage,
              answers: classification.answers,
            }
          : { status: 'provider_failure' as const, errorCode: classification.failure.code },
    })),
  }
}

/**
 * Why a snapshot cannot be counted:
 * - `unknown_fixture`: it names a case this build does not have, so what was
 *   measured cannot be looked up.
 * - `changed_fixture`: the labelled thread has changed since the run. The
 *   answers describe mail this build no longer holds, and the expectation
 *   beside them may have been written for either one.
 * - `unsupported_rubric`: it was judged under a rubric this build no longer
 *   holds. Its categories, priorities and thresholds meant something else,
 *   and today's policy is not what produced those answers.
 *
 * Every reason is content-free, as are the fixture and rubric beside it, so
 * a refusal may be printed and logged as it is.
 */
export type SnapshotRefusal = 'unknown_fixture' | 'changed_fixture' | 'unsupported_rubric'

export type SnapshotReplay =
  | Readonly<{ status: 'replayed'; observations: readonly QualityObservation[] }>
  | Readonly<{ status: 'refused'; reason: SnapshotRefusal; fixture: string; rubric: string }>

const refused = (
  reason: SnapshotRefusal,
  entry: RunSnapshot['entries'][number],
): SnapshotReplay => ({
  status: 'refused',
  reason,
  fixture: entry.fixture,
  rubric: entry.rubric,
})

/**
 * The observations a snapshot stands for, or the first reason it cannot be
 * counted. One refused entry refuses the run: a report over the rest would
 * be a different run's report, printed under this one's name.
 */
export function replayRunSnapshot(
  snapshot: RunSnapshot,
  cases: readonly ReviewedCase[] = reviewedCases,
): SnapshotReplay {
  const observations: QualityObservation[] = []
  for (const entry of snapshot.entries) {
    const reviewed = cases.find(({ fixture }) => fixture === entry.fixture)
    if (reviewed === undefined) return refused('unknown_fixture', entry)
    if (!isReportableRubric(entry.rubric)) return refused('unsupported_rubric', entry)
    const thread = reviewedThread(reviewed)
    if (threadDigest(thread) !== entry.threadDigest) return refused('changed_fixture', entry)
    observations.push({
      reviewed,
      classification: classificationOf(entry, thread.id, entry.rubric),
      latencyMs: entry.latencyMs,
    })
  }
  return { status: 'replayed', observations }
}

/** The classification the run received, rebuilt from what was written down. */
function classificationOf(
  entry: RunSnapshot['entries'][number],
  threadId: string,
  rubric: JevClassification['rubric'],
): JevClassification {
  const subject = { threadId, rubric, requestedModel: entry.requestedModel }
  const { result } = entry
  if (result.status === 'provider_failure') {
    return {
      ...subject,
      status: 'provider_failure',
      // A detail and an HTTP status are never kept, and the report counts
      // failures by code alone, so nothing is lost by saying so here.
      failure: { code: result.errorCode, detail: null, httpStatus: null },
    }
  }
  return {
    ...subject,
    status: 'classified',
    model: result.model,
    usage: result.usage,
    answers: result.answers,
  }
}
