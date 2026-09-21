/**
 * The only module that talks to TypeSafe. It uses the official SDK against a
 * pinned base URL and never logs: SDK debug logs include request bodies.
 */
import {
  APIConnectionError,
  APIError,
  APITimeoutError,
  APIUserAbortError,
  TypeSafeClient,
  type Fetch,
} from '@typesafe-ai/sdk'
import { JevError, type JevErrorCode } from './errors'
import type { triageQuestions } from './questions'
import type { TriageState } from './state'

export interface JevRequest {
  model: string
  state: TriageState
  questions: typeof triageQuestions
}

/**
 * Sends one request and resolves with the unvalidated response body. Fails
 * with a `JevError` when the provider cannot answer.
 */
export type JevTransport = (request: JevRequest, signal?: AbortSignal) => Promise<unknown>

const typesafeBaseUrl = 'https://api.typesafe.ai'

/**
 * Evaluation has no side effects, so the SDK's bounded retries on rate
 * limits, server errors, and timeouts are safe to keep.
 */
const retry = { maxRetries: 2 }

export function createSdkTransport({
  apiKey,
  fetch,
  timeoutMs = 10_000,
}: {
  apiKey: string
  /** For tests; defaults to the global `fetch`. */
  fetch?: Fetch
  /** Per attempt; the SDK retries at most twice. */
  timeoutMs?: number
}): JevTransport {
  const client = new TypeSafeClient({
    apiKey,
    // Explicit, so TYPESAFE_BASE_URL cannot send the key elsewhere.
    baseURL: typesafeBaseUrl,
    logLevel: 'off',
    timeout: timeoutMs,
    retry,
    ...(fetch === undefined ? {} : { fetch }),
  })
  return async (request, signal) => {
    try {
      return await client.systemOne(request, signal === undefined ? {} : { signal })
    } catch (error) {
      throw toJevError(error)
    }
  }
}

/** Maps SDK failures to content-free errors; anything else passes through. */
function toJevError(error: unknown): unknown {
  if (error instanceof APIUserAbortError) return new JevError('aborted')
  if (error instanceof APITimeoutError) return new JevError('timeout')
  if (error instanceof APIConnectionError) return new JevError('unavailable')
  if (error instanceof APIError) return new JevError(statusCode(error.status), null, error.status)
  return error
}

function statusCode(status: number): JevErrorCode {
  if (status === 401 || status === 403) return 'unauthorized'
  if (status === 429) return 'rate_limited'
  if (status >= 500) return 'unavailable'
  return 'rejected_request'
}
