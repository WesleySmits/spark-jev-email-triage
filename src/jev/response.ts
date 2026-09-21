/**
 * The Jev response contract for `triageQuestions`. Provider output is
 * untrusted until it parses here.
 *
 * Invariants:
 * - Exactly the asked questions are answered, each with its question type.
 * - Choice labels and probability keys are the rubric's labels, no more.
 * - Probabilities and confidence lie in [0, 1]; a distribution sums to 1
 *   within the rounding error of its labels.
 * - The chosen label is most probable within `nearTieTolerance`. A near tie
 *   is uncertainty, not a broken response; policy resolves it.
 */
import { z } from 'zod'
import { categorySchema, prioritySchema, sumsToOne } from '../domain/triage'

/**
 * Jev rounds each probability to two decimals, so each can be off by up to
 * half a point and the sum by that much per label: 0.04 for eight labels.
 */
const roundingErrorPerLabel = 0.005

/**
 * Jev has named a label a few points below the most probable one in a near
 * tie. A larger gap means the answer contradicts itself.
 */
const nearTieTolerance = 0.02

const probability = z.number().min(0).max(1)

function choiceAnswer<L extends string>(labels: z.ZodEnum<Record<L, L>>) {
  return z
    .object({
      type: z.literal('choice'),
      choice: labels,
      probabilities: z
        .record(labels, probability)
        .refine(
          (probabilities) =>
            sumsToOne(probabilities, labels.options.length * roundingErrorPerLabel),
          {
            message: 'Probabilities must sum to 1',
          },
        ),
      confidence: probability,
    })
    .refine(
      ({ choice, probabilities }) =>
        Object.values<number>(probabilities).every(
          (value) => value - probabilities[choice] <= nearTieTolerance,
        ),
      { message: 'The chosen label must be the most probable', path: ['choice'] },
    )
}

const noulAnswer = z.object({
  type: z.literal('noul'),
  noul: probability,
})

export const triageResponseSchema = z.object({
  /** The versioned model that answered, which may differ from the request. */
  model: z.string().trim().min(1),
  answers: z.strictObject({
    category: choiceAnswer(categorySchema),
    priority: choiceAnswer(prioritySchema),
    reply_expected: noulAnswer,
    deadline: noulAnswer,
    credential_request: noulAnswer,
    sender_impersonation: noulAnswer,
    payment_redirect: noulAnswer,
    automated_reader_instructions: noulAnswer,
  }),
  usage: z.object({
    input_tokens: z.int().nonnegative(),
    output_tokens: z.int().nonnegative(),
  }),
})

export type TriageAnswers = z.infer<typeof triageResponseSchema>['answers']
