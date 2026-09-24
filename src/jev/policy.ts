/**
 * Conservative triage policy over Jev judgments. Thresholds come from the
 * rubric in `src/domain/rubric.ts` and are not yet calibrated on real mail.
 *
 * Invariants:
 * - The outcome labels a thread for review; it authorizes no mailbox action.
 * - A provider failure never looks like a classification.
 * - An ambiguous or low-confidence category needs review. An uncertain
 *   priority is reported but does not force review.
 * - Suspicion can only add review reasons and raise review priority.
 */
import type { z } from 'zod'
import { defaultRubric } from '../domain/rubric'
import {
  categorySchema,
  resolveTriage,
  suspicionSignalSchema,
  triageDecisionSchema,
  type prioritySchema,
  type ReviewReason,
  type SuspicionSignal,
  type TriageDecision,
} from '../domain/triage'
import type { JevClassification } from './classifier'
import type { TriageAnswers } from './response'

const { thresholds } = defaultRubric

/**
 * The questions a suspicion signal is read from. The signals themselves are
 * the rubric's, in `src/domain/triage.ts`, so the code a run stores and the
 * question it came from cannot drift apart; `satisfies` keeps every one of
 * them a question this classifier actually asks.
 */
export const suspicionQuestions: readonly SuspicionSignal[] =
  suspicionSignalSchema.options satisfies readonly (keyof TriageAnswers)[]

type Signal = 'likely' | 'uncertain' | 'unlikely'

/**
 * Why one outcome needs a person: a policy rule from the rubric, or a call that
 * answered nothing, which is a ground of the attempt rather than of a judgment.
 */
export type OutcomeReason = ReviewReason | 'provider_failure'

export type TriageOutcome =
  | {
      status: 'unclassified'
      threadId: string
      review: 'needs_review'
      reviewPriority: 'normal'
      reasons: ['provider_failure']
    }
  | {
      status: 'classified'
      threadId: string
      category: z.infer<typeof categorySchema>
      priority: z.infer<typeof prioritySchema>
      /** Jev was not confident about the priority. Shown, not reviewed. */
      priorityUncertain: boolean
      /** Probability of the chosen category, normalized. */
      confidence: number
      /** `auto_accepted` accepts the labels only; it permits no action. */
      review: 'auto_accepted' | 'needs_review'
      reviewPriority: 'normal' | 'elevated'
      reasons: OutcomeReason[]
      replyExpected: Signal
      deadline: Signal
      suspicionSignals: SuspicionSignal[]
    }

export function resolveClassification(classification: JevClassification): TriageOutcome {
  if (classification.status === 'provider_failure') {
    return {
      status: 'unclassified',
      threadId: classification.threadId,
      review: 'needs_review',
      reviewPriority: 'normal',
      reasons: ['provider_failure'],
    }
  }
  const { answers } = classification
  const decision = toDecision(classification)
  const { review } = resolveTriage(decision, null)
  const suspicionSignals = suspicionQuestions.filter(
    (question) => answers[question].noul >= thresholds.suspicionFloor,
  )
  const reasons: OutcomeReason[] = [
    ...(review === 'needs_review' ? ['low_category_confidence' as const] : []),
    ...(decision.category === 'other' ? ['ambiguous_category' as const] : []),
    ...(suspicionSignals.length > 0 || decision.category === 'suspicious'
      ? ['suspicious' as const]
      : []),
  ]
  return {
    status: 'classified',
    threadId: classification.threadId,
    category: decision.category,
    priority: decision.priority,
    priorityUncertain: answers.priority.confidence < thresholds.priorityConfidence,
    confidence: decision.probabilities[decision.category],
    review: reasons.length === 0 ? 'auto_accepted' : 'needs_review',
    reviewPriority: reasons.includes('suspicious') ? 'elevated' : 'normal',
    reasons,
    replyExpected: signal(answers.reply_expected.noul),
    deadline: signal(answers.deadline.noul),
    suspicionSignals,
  }
}

/**
 * The domain decision, with category probabilities rescaled to sum to 1.
 * In a near tie the most probable label wins over Jev's named choice.
 */
function toDecision(
  classification: Extract<JevClassification, { status: 'classified' }>,
): TriageDecision {
  const { category, priority } = classification.answers
  const total = Object.values(category.probabilities).reduce((sum, value) => sum + value, 0)
  const top = categorySchema.options.reduce(
    (best, label) => (category.probabilities[label] > category.probabilities[best] ? label : best),
    category.choice,
  )
  return triageDecisionSchema.parse({
    threadId: classification.threadId,
    rubric: classification.rubric,
    category: top,
    priority: priority.choice,
    probabilities: Object.fromEntries(
      Object.entries(category.probabilities).map(([label, value]) => [label, value / total]),
    ),
  })
}

function signal(probability: number): Signal {
  if (probability >= thresholds.likely) return 'likely'
  if (probability <= thresholds.unlikely) return 'unlikely'
  return 'uncertain'
}
