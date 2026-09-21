/**
 * Conservative triage policy over Jev judgments. Thresholds are ordinary
 * code, versioned with the rubric, and not yet calibrated on real mail.
 *
 * Invariants:
 * - The outcome labels a thread for review; it authorizes no mailbox action.
 * - A provider failure never looks like a classification.
 * - An ambiguous or low-confidence judgment needs review.
 * - Suspicion can only add review reasons and raise review priority.
 */
import type { z } from 'zod'
import {
  categorySchema,
  resolveTriage,
  triageDecisionSchema,
  type prioritySchema,
  type TriageDecision,
} from '../domain/triage'
import type { JevClassification } from './classifier'
import type { TriageAnswers } from './response'

const thresholds: Record<TriageDecision['rubric'], PolicyThresholds> = {
  'email-triage.v1': {
    minPriorityConfidence: 0.5,
    // Low on purpose: a false alarm costs a closer look, a miss costs more.
    suspicionFloor: 0.4,
    likely: 0.7,
    unlikely: 0.3,
  },
}

interface PolicyThresholds {
  /** Below this Choice confidence, priority needs review. */
  minPriorityConfidence: number
  /** At or above this probability, a suspicion signal counts. */
  suspicionFloor: number
  /** Noul probabilities at or above `likely` read as likely, at or below `unlikely` as unlikely. */
  likely: number
  unlikely: number
}

export const suspicionQuestions = [
  'credential_request',
  'sender_impersonation',
  'payment_redirect',
  'automated_reader_instructions',
] as const satisfies readonly (keyof TriageAnswers)[]

type SuspicionSignal = (typeof suspicionQuestions)[number]
type Signal = 'likely' | 'uncertain' | 'unlikely'

export type ReviewReason =
  | 'provider_failure'
  | 'low_category_confidence'
  | 'ambiguous_category'
  | 'low_priority_confidence'
  | 'suspicious'

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
      /** Probability of the chosen category, normalized. */
      confidence: number
      /** `auto_accepted` accepts the labels only; it permits no action. */
      review: 'auto_accepted' | 'needs_review'
      reviewPriority: 'normal' | 'elevated'
      reasons: ReviewReason[]
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
  const policy = thresholds[classification.rubric]
  const decision = toDecision(classification)
  const { review } = resolveTriage(decision, null)
  const suspicionSignals = suspicionQuestions.filter(
    (question) => answers[question].noul >= policy.suspicionFloor,
  )
  const reasons: ReviewReason[] = [
    ...(review === 'needs_review' ? ['low_category_confidence' as const] : []),
    ...(decision.category === 'other' ? ['ambiguous_category' as const] : []),
    ...(answers.priority.confidence < policy.minPriorityConfidence
      ? ['low_priority_confidence' as const]
      : []),
    ...(suspicionSignals.length > 0 || decision.category === 'suspicious'
      ? ['suspicious' as const]
      : []),
  ]
  return {
    status: 'classified',
    threadId: classification.threadId,
    category: decision.category,
    priority: decision.priority,
    confidence: decision.probabilities[decision.category],
    review: reasons.length === 0 ? 'auto_accepted' : 'needs_review',
    reviewPriority: reasons.includes('suspicious') ? 'elevated' : 'normal',
    reasons,
    replyExpected: signal(answers.reply_expected.noul, policy),
    deadline: signal(answers.deadline.noul, policy),
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

function signal(probability: number, { likely, unlikely }: PolicyThresholds): Signal {
  if (probability >= likely) return 'likely'
  if (probability <= unlikely) return 'unlikely'
  return 'uncertain'
}
