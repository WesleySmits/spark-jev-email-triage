/**
 * Synthetic Jev responses for tests, and the classifications they parse to.
 * Values are invented, not recorded from the provider. Anything measuring
 * the classifier — the shadow store, the quality report — builds its answers
 * here rather than keeping a copy of its own.
 */
import type { z } from 'zod'
import { categorySchema, currentTriageRubric, prioritySchema } from '../domain/triage'
import type { JevClassification } from './classifier'
import { jevModel } from './questions'
import { triageResponseSchema } from './response'

type ResponseBody = z.input<typeof triageResponseSchema>
type Answers = ResponseBody['answers']
export type NoulQuestionId = {
  [K in keyof Answers]: Answers[K] extends { type: 'noul' } ? K : never
}[keyof Answers]

export interface ResponseOptions {
  category?: z.infer<typeof categorySchema>
  /** Probability of `category`; the other labels share the rest. */
  categoryShare?: number
  priority?: z.infer<typeof prioritySchema>
  priorityShare?: number
  nouls?: Partial<Record<NoulQuestionId, number>>
}

/** A confident customer request that expects a reply and has no deadline. */
export function jevResponse({
  category = 'personal',
  categoryShare = 0.9,
  priority = 'high',
  priorityShare = 0.9,
  nouls = {},
}: ResponseOptions = {}): ResponseBody {
  const noul = (id: NoulQuestionId, fallback: number) => ({
    type: 'noul' as const,
    noul: nouls[id] ?? fallback,
  })
  return {
    model: 'jev-1.13.0',
    answers: {
      category: choiceAnswer(categorySchema.options, category, categoryShare),
      priority: choiceAnswer(prioritySchema.options, priority, priorityShare),
      reply_expected: noul('reply_expected', 0.9),
      deadline: noul('deadline', 0.1),
      credential_request: noul('credential_request', 0.02),
      sender_impersonation: noul('sender_impersonation', 0.02),
      payment_redirect: noul('payment_redirect', 0.02),
      automated_reader_instructions: noul('automated_reader_instructions', 0.02),
    },
    usage: { input_tokens: 812, output_tokens: 64 },
  }
}

function choiceAnswer<L extends string>(labels: readonly L[], choice: L, share: number) {
  const rest = (1 - share) / (labels.length - 1)
  const probabilities = Object.fromEntries(
    labels.map((label) => [label, label === choice ? share : rest]),
  ) as Record<L, number>
  return {
    type: 'choice' as const,
    choice,
    probabilities,
    // The documented approximation: 1 when certain, 0 when uniform.
    confidence: Math.max(0, (labels.length * share - 1) / (labels.length - 1)),
  }
}

/** The rubric and classifier build a synthetic classification names. */
const judge = { rubric: currentTriageRubric, requestedModel: jevModel } as const

/** A Jev judgment of one thread, as the classifier returns one. */
export function jevJudgment(threadId: string, options: ResponseOptions = {}): JevClassification {
  const body = triageResponseSchema.parse(jevResponse(options))
  return {
    ...judge,
    threadId,
    status: 'classified',
    model: body.model,
    usage: { inputTokens: body.usage.input_tokens, outputTokens: body.usage.output_tokens },
    answers: body.answers,
  }
}

/** A Jev call that gave no usable answer. It is never a classification. */
export const jevFailure = (threadId: string): JevClassification => ({
  ...judge,
  threadId,
  status: 'provider_failure',
  failure: { code: 'timeout', detail: null, httpStatus: null },
})
