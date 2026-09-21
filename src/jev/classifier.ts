/**
 * Turns one normalized thread into typed Jev judgments. It asks questions
 * and validates answers; policy lives in `policy.ts`.
 */
import type { z } from 'zod'
import type { threadSchema } from '../domain/email'
import { currentTriageRubric } from '../domain/triage'
import { JevError, type JevErrorCode } from './errors'
import { jevModel, triageQuestions } from './questions'
import { triageResponseSchema, type TriageAnswers } from './response'
import { buildTriageState } from './state'
import type { JevTransport } from './transport'

interface ClassificationSubject {
  threadId: string
  rubric: typeof currentTriageRubric
  requestedModel: string
}

export type JevClassification =
  | (ClassificationSubject & {
      status: 'classified'
      /** The versioned model that answered. */
      model: string
      usage: { inputTokens: number; outputTokens: number }
      /** Validated answers with the provider's raw probabilities. */
      answers: TriageAnswers
    })
  | (ClassificationSubject & {
      /** The provider gave no usable answer. This is not model uncertainty. */
      status: 'provider_failure'
      failure: { code: JevErrorCode; detail: string | null; httpStatus: number | null }
    })

interface ClassifyRequest {
  thread: z.infer<typeof threadSchema>
  /** The mailbox the thread belongs to, to tell its owner's messages apart. */
  mailboxAddress: string
}

export function createJevClassifier(transport: JevTransport) {
  return async function classify(
    { thread, mailboxAddress }: ClassifyRequest,
    signal?: AbortSignal,
  ): Promise<JevClassification> {
    const subject: ClassificationSubject = {
      threadId: thread.id,
      rubric: currentTriageRubric,
      requestedModel: jevModel,
    }
    const request = {
      model: jevModel,
      state: buildTriageState(thread, mailboxAddress),
      questions: triageQuestions,
    }
    let body: unknown
    try {
      body = await transport(request, signal)
    } catch (error) {
      if (error instanceof JevError) return failed(subject, error)
      throw error
    }
    const parsed = triageResponseSchema.safeParse(body)
    if (!parsed.success) {
      // Only the path of the first issue: values may echo email content.
      const path = parsed.error.issues[0]?.path.join('.') ?? null
      return failed(subject, new JevError('malformed_response', path === '' ? null : path))
    }
    const { model, usage, answers } = parsed.data
    return {
      ...subject,
      status: 'classified',
      model,
      usage: { inputTokens: usage.input_tokens, outputTokens: usage.output_tokens },
      answers,
    }
  }
}

const failed = (subject: ClassificationSubject, error: JevError): JevClassification => ({
  ...subject,
  status: 'provider_failure',
  failure: { code: error.code, detail: error.detail, httpStatus: error.httpStatus },
})
