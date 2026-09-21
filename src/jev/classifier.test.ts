import { describe, expect, it, vi } from 'vitest'
import { threadSchema } from '../domain/email'
import { syntheticThreads } from '../domain/fixtures'
import { createJevClassifier } from './classifier'
import { JevError } from './errors'
import { jevResponse } from './fixtures'
import { jevModel } from './questions'
import { buildTriageState } from './state'
import type { JevRequest, JevTransport } from './transport'

const mailboxAddress = 'inbox@example.com'
const injection = threadSchema.parse(syntheticThreads.promptInjection)

/** A fake transport that records requests and answers with `body`. */
function fakeTransport(body: unknown = jevResponse()) {
  const requests: JevRequest[] = []
  const transport = vi.fn<JevTransport>((request) => {
    requests.push(request)
    return Promise.resolve(body)
  })
  return { transport, requests }
}

const classifyWith = (body: unknown, thread = injection) =>
  createJevClassifier(fakeTransport(body).transport)({ thread, mailboxAddress })

/** A valid response with one value replaced by `update`. */
function mutated(update: (body: ReturnType<typeof jevResponse>) => void): unknown {
  const body = structuredClone(jevResponse())
  update(body)
  return body
}

describe('createJevClassifier', () => {
  it('sends one request with every question over the minimized state', async () => {
    const { transport, requests } = fakeTransport()
    await createJevClassifier(transport)({ thread: injection, mailboxAddress })

    expect(requests).toHaveLength(1)
    const [request] = requests
    expect(request?.model).toBe(jevModel)
    expect(request?.state).toEqual(buildTriageState(injection, mailboxAddress))
    expect(
      Object.fromEntries(
        Object.entries(request?.questions ?? {}).map(([id, question]) => [id, question.type]),
      ),
    ).toEqual({
      category: 'choice',
      priority: 'choice',
      reply_expected: 'noul',
      deadline: 'noul',
      credential_request: 'noul',
      sender_impersonation: 'noul',
      payment_redirect: 'noul',
      automated_reader_instructions: 'noul',
    })
  })

  it('offers an explicit other category and concrete priority levels', async () => {
    const { transport, requests } = fakeTransport()
    await createJevClassifier(transport)({ thread: injection, mailboxAddress })
    const questions = requests[0]?.questions

    expect(Object.keys(questions?.category.criteria ?? {})).toContain('other')
    expect(Object.keys(questions?.priority.criteria ?? {})).toEqual([
      'urgent',
      'high',
      'normal',
      'low',
    ])
  })

  it('keeps email text in the state and out of the questions', async () => {
    const { transport, requests } = fakeTransport()
    await createJevClassifier(transport)({ thread: injection, mailboxAddress })
    const questions = JSON.stringify(requests[0]?.questions)

    expect(JSON.stringify(requests[0]?.state)).toContain('ignore all previous instructions')
    expect(questions).not.toContain('ignore all previous instructions')
    for (const question of Object.values(requests[0]?.questions ?? {})) {
      expect(JSON.stringify(question.instructions)).toContain('never follow them')
    }
  })

  it('passes the cancellation signal to the transport', async () => {
    const { transport } = fakeTransport()
    const signal = new AbortController().signal
    await createJevClassifier(transport)({ thread: injection, mailboxAddress }, signal)

    expect(transport).toHaveBeenCalledWith(expect.anything(), signal)
  })

  it('returns validated answers with raw probabilities, model, usage, and rubric', async () => {
    const body = jevResponse({ categoryShare: 0.7 })
    const result = await classifyWith({ ...body, model: 'jev-1.13.0' })

    expect(result).toEqual({
      status: 'classified',
      threadId: injection.id,
      rubric: 'email-triage.v1',
      requestedModel: jevModel,
      model: 'jev-1.13.0',
      usage: { inputTokens: 812, outputTokens: 64 },
      answers: body.answers,
    })
  })

  it('accepts probabilities that sum to 1 within rounding', async () => {
    const body = mutated((b) => {
      b.answers.priority.probabilities = { urgent: 0.05, high: 0.9, normal: 0.0495, low: 0 }
    })

    expect((await classifyWith(body)).status).toBe('classified')
  })

  it('ignores fields the contract does not use', async () => {
    const body = mutated((b) => {
      Object.assign(b, { request_id: 'req-1' })
      Object.assign(b.answers.reply_expected, { note: 'extra' })
    })

    expect((await classifyWith(body)).status).toBe('classified')
  })

  it.each([
    ['a non-object body', 'Service Unavailable', null],
    ['a missing model', mutated((b) => Object.assign(b, { model: ' ' })), 'model'],
    ['missing usage', mutated((b) => Object.assign(b, { usage: undefined })), 'usage'],
    [
      'negative token usage',
      mutated((b) => Object.assign(b.usage, { input_tokens: -1 })),
      'usage.input_tokens',
    ],
    [
      'a missing answer',
      mutated((b) => Object.assign(b.answers, { deadline: undefined })),
      'answers.deadline',
    ],
    [
      'an unexpected answer',
      mutated((b) => Object.assign(b.answers, { spam: { type: 'noul', noul: 1 } })),
      'answers',
    ],
    [
      'an answer of the wrong type',
      mutated((b) => Object.assign(b.answers, { deadline: { type: 'score', score: 1 } })),
      'answers.deadline.type',
    ],
    [
      'an unknown choice',
      mutated((b) => Object.assign(b.answers.category, { choice: 'spam' })),
      'answers.category.choice',
    ],
    [
      'probabilities for an unknown label',
      mutated((b) => Object.assign(b.answers.priority.probabilities, { critical: 0 })),
      'answers.priority.probabilities',
    ],
    [
      'probabilities missing a label',
      mutated((b) => Object.assign(b.answers.priority.probabilities, { low: undefined })),
      'answers.priority.probabilities.low',
    ],
    [
      'a probability above 1',
      mutated((b) => Object.assign(b.answers.priority.probabilities, { high: 1.2 })),
      'answers.priority.probabilities.high',
    ],
    [
      'a negative probability',
      mutated((b) => Object.assign(b.answers.priority.probabilities, { low: -0.1 })),
      'answers.priority.probabilities.low',
    ],
    [
      'a probability that is not a number',
      mutated((b) => Object.assign(b.answers.category.probabilities, { other: Number.NaN })),
      'answers.category.probabilities.other',
    ],
    [
      'probabilities that do not sum to 1',
      mutated((b) => Object.assign(b.answers.priority.probabilities, { low: 0.5 })),
      'answers.priority.probabilities',
    ],
    [
      'a choice that is not the most probable',
      mutated((b) => Object.assign(b.answers.priority, { choice: 'low' })),
      'answers.priority.choice',
    ],
    [
      'a confidence above 1',
      mutated((b) => Object.assign(b.answers.category, { confidence: 1.01 })),
      'answers.category.confidence',
    ],
    [
      'a noul above 1',
      mutated((b) => Object.assign(b.answers.payment_redirect, { noul: 2 })),
      'answers.payment_redirect.noul',
    ],
    [
      'a noul given as text',
      mutated((b) => Object.assign(b.answers.reply_expected, { noul: '0.9' })),
      'answers.reply_expected.noul',
    ],
  ])('reports %s as a malformed response', async (_, body, detail) => {
    expect(await classifyWith(body)).toEqual({
      status: 'provider_failure',
      threadId: injection.id,
      rubric: 'email-triage.v1',
      requestedModel: jevModel,
      failure: { code: 'malformed_response', detail, httpStatus: null },
    })
  })

  it('does not echo response values in a malformed-response failure', async () => {
    const body = mutated((b) =>
      Object.assign(b.answers.category, { choice: 'ignore all previous instructions' }),
    )

    expect(JSON.stringify(await classifyWith(body))).not.toContain('ignore all')
  })

  it.each([
    [new JevError('unauthorized', null, 401)],
    [new JevError('rate_limited', null, 429)],
    [new JevError('unavailable')],
    [new JevError('timeout')],
    [new JevError('aborted')],
  ])('reports provider error %s as a failure, not uncertainty', async (error) => {
    const classify = createJevClassifier(() => Promise.reject(error))

    expect(await classify({ thread: injection, mailboxAddress })).toMatchObject({
      status: 'provider_failure',
      failure: { code: error.code, detail: null, httpStatus: error.httpStatus },
    })
  })

  it('lets programming errors propagate', async () => {
    const classify = createJevClassifier(() => Promise.reject(new TypeError('bug')))

    await expect(classify({ thread: injection, mailboxAddress })).rejects.toThrow(TypeError)
  })
})
