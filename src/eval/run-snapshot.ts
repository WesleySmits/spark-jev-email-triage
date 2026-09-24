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
 *   stays in the repository's evaluation fixtures where a reviewer read it. So
 *   no subject, address, body or attachment can travel in a snapshot, and a
 *   replay still fails loudly when the labelled thread has changed since:
 *   the digest is recomputed from the thread this build holds and compared
 *   with the one the run measured.
 * - The expectation the run was measured against travels as its labels: the
 *   category, the priority and the handling a reviewer settled on, and none of
 *   the prose that argued for them. A run is a comparison, so pinning only
 *   the mail pins half of it. Reading a case again and correcting its labels
 *   is an ordinary outcome here — two of the cases in the set began that way
 *   — and it leaves the thread, and therefore its digest, untouched. A replay
 *   against labels nobody had yet written when the run happened would count
 *   another comparison and print it under this run's name, so the labels are
 *   compared as the mail is, and a run measured against labels this build no
 *   longer holds is refused.
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
import { categorySchema, prioritySchema } from '../domain/triage'
import type { JevClassification } from '../jev/classifier'
import { jevErrorCodes } from '../jev/errors'
import { triageResponseSchema } from '../jev/response'
import { isReportableRubric, type QualityObservation } from './quality-report'
import {
  reviewedCases,
  reviewedThread,
  type ReviewedCase,
  type ReviewedExpectation,
} from './reviewed-set'
import { threadDigest } from './thread-digest'

const name = z.string().trim().min(1)

/** Model names printed in reports must be version identifiers, never free text. */
const modelVersion = z.string().regex(/^jev-\d{1,3}\.\d{1,3}\.\d{1,3}$/)

/**
 * Every handling a case can expect. `captureRunSnapshot` writes an
 * expectation's handling into this schema, so a handling the set gains later
 * and this list lacks is a type error rather than a snapshot that cannot say
 * what its run was measured against.
 */
const handlings = [
  'needs_person',
  'may_auto_label',
] as const satisfies readonly ReviewedExpectation['handling'][]

/**
 * The labels the run was measured against: what the figures compare a
 * judgment with, and nothing else. The argument a reviewer wrote for them is
 * prose about mail and stays in `reviewed-set.ts`.
 */
const expectationSchema = z.strictObject({
  category: categorySchema,
  priority: prioritySchema,
  handling: z.enum(handlings),
})

/** What one call to the classifier returned, as the run validated it. */
const resultSchema = z.discriminatedUnion('status', [
  z.strictObject({
    status: z.literal('classified'),
    /** The versioned model that answered, which may differ from the request. */
    model: modelVersion,
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
  /** The labels that case expected when the run was made. */
  expectation: expectationSchema,
  /** The rubric the classifier judged under. */
  rubric: name,
  /** The pinned classifier build that was asked. */
  requestedModel: modelVersion,
  /** Wall-clock milliseconds of the call, or `null` where nothing timed it. */
  latencyMs: z.number().nonnegative().nullable(),
  result: resultSchema,
})

export const runSnapshotSchema = z.strictObject({
  /**
   * Bumped when the shape changes, so an older file is refused, not misread.
   * Version 2 pins the expected labels beside the answers; a version 1 file
   * did not carry them, and recounting one against whatever the set says
   * today is exactly the silent change this field exists to prevent.
   */
  version: z.literal(2),
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
    version: 2,
    capturedAt,
    entries: observations.map(({ reviewed, classification, latencyMs }) => ({
      fixture: reviewed.fixture,
      threadDigest: reviewed.writtenAgainst.threadDigest,
      expectation: expectedLabels(reviewed.expectation),
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
 * - `changed_expectation`: the mail is the mail the run measured, but a
 *   person has read the case again and settled on other labels since. The
 *   answers are still the answers; what they would be counted against is
 *   not, so the figures would be another comparison under this run's name.
 * - `unsupported_rubric`: it was judged under a rubric this build no longer
 *   holds. Its categories, priorities and thresholds meant something else,
 *   and today's policy is not what produced those answers.
 *
 * Every reason is content-free, so a refusal may be printed and logged.
 */
export type SnapshotRefusal =
  'unknown_fixture' | 'changed_fixture' | 'changed_expectation' | 'unsupported_rubric'

export type SnapshotReplay =
  | Readonly<{ status: 'replayed'; observations: readonly QualityObservation[] }>
  | Readonly<{ status: 'refused'; reason: SnapshotRefusal }>

const refused = (reason: SnapshotRefusal): SnapshotReplay => ({
  status: 'refused',
  reason,
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
    if (reviewed === undefined) return refused('unknown_fixture')
    if (!isReportableRubric(entry.rubric)) return refused('unsupported_rubric')
    const thread = reviewedThread(reviewed)
    if (threadDigest(thread) !== entry.threadDigest) return refused('changed_fixture')
    if (!sameLabels(expectedLabels(reviewed.expectation), entry.expectation)) {
      return refused('changed_expectation')
    }
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

/** An expectation reduced to the labels a figure is counted against. */
const expectedLabels = ({ category, priority, handling }: ReviewedExpectation) => ({
  category,
  priority,
  handling,
})

/**
 * Whether a case still expects what it expected when the run was made. Every
 * label counts, including priority: an expectation is one judgment a
 * reviewer settled on, and a run measured against one
 * version of it was not measured against the next.
 */
const sameLabels = (
  current: z.infer<typeof expectationSchema>,
  measured: z.infer<typeof expectationSchema>,
) =>
  current.category === measured.category &&
  current.priority === measured.priority &&
  current.handling === measured.handling
