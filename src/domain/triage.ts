/**
 * Triage decisions and human corrections, independent of the classifier
 * that produces them.
 *
 * Invariants:
 * - Every decision and correction names the rubric version whose categories
 *   and policy it uses.
 * - Category probabilities cover every category, lie in [0, 1], and sum to 1.
 * - The decided category has the highest probability.
 * - A human correction always wins over the model decision.
 */
import { z } from 'zod'
import { threadSchema } from './email'
import { defaultRubric, triageCategories, triagePriorities } from './rubric'

export const categorySchema = z.enum(triageCategories)
export const prioritySchema = z.enum(triagePriorities)

/**
 * Only the current rubric. `email-triage.v1` (support-desk categories) was
 * dropped before anything was stored; once decisions are persisted, keep old
 * ids here so stored decisions and corrections stay parseable.
 */
const rubricSchema = z.enum([defaultRubric.id])

export const currentTriageRubric: z.infer<typeof rubricSchema> = defaultRubric.id

const probabilitySumTolerance = 1e-6

/** Whether a distribution sums to 1 within `tolerance`. */
export const sumsToOne = (probabilities: Record<string, number>, tolerance: number) =>
  Math.abs(Object.values(probabilities).reduce((sum, value) => sum + value, 0) - 1) <= tolerance

const categoryProbabilitiesSchema = z
  .record(categorySchema, z.number().min(0).max(1))
  .refine((probabilities) => sumsToOne(probabilities, probabilitySumTolerance), {
    message: 'Category probabilities must sum to 1',
  })

export const triageDecisionSchema = z
  .strictObject({
    threadId: threadSchema.shape.id,
    rubric: rubricSchema,
    category: categorySchema,
    priority: prioritySchema,
    probabilities: categoryProbabilitiesSchema,
  })
  .refine(
    ({ category, probabilities }) =>
      triageCategories.every((other) => probabilities[other] <= probabilities[category]),
    { message: 'The decided category must have the highest probability', path: ['category'] },
  )

export const triageCorrectionSchema = z.strictObject({
  threadId: threadSchema.shape.id,
  rubric: rubricSchema,
  category: categorySchema,
  priority: prioritySchema,
  correctedAt: z.iso.datetime({ offset: true }),
})

export type TriageDecision = z.infer<typeof triageDecisionSchema>
type TriageCorrection = z.infer<typeof triageCorrectionSchema>

interface TriageSubject {
  threadId: string
  rubric: string
}

const sameSubject = (a: TriageSubject, b: TriageSubject) =>
  a.threadId === b.threadId && a.rubric === b.rubric

/**
 * The triage outcome to act on. The caller must pass the correction for the
 * decision's thread and rubric, or `null` when no human has reviewed it.
 */
export function resolveTriage(decision: TriageDecision, correction: TriageCorrection | null) {
  if (correction === null) {
    const confidence = decision.probabilities[decision.category]
    return {
      category: decision.category,
      priority: decision.priority,
      confidence,
      review:
        confidence >= defaultRubric.thresholds.autoAccept
          ? ('auto_accepted' as const)
          : ('needs_review' as const),
    }
  }
  if (!sameSubject(correction, decision)) {
    throw new Error('Correction does not match the decision thread and rubric')
  }
  return {
    category: correction.category,
    priority: correction.priority,
    confidence: null,
    review: 'human_reviewed' as const,
  }
}
