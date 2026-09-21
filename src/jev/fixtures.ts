/**
 * Synthetic Jev responses for tests. Values are invented, not recorded from
 * the provider.
 */
import type { z } from 'zod'
import { categorySchema, prioritySchema } from '../domain/triage'
import type { triageResponseSchema } from './response'

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
