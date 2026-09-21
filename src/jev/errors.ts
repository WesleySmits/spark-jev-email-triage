const messages = {
  unauthorized: 'TypeSafe rejected the API key',
  rate_limited: 'TypeSafe rate limit exceeded',
  unavailable: 'TypeSafe is unavailable',
  timeout: 'The TypeSafe call timed out',
  aborted: 'The TypeSafe call was cancelled',
  rejected_request: 'TypeSafe rejected the request',
  malformed_response: 'TypeSafe returned a response outside the contract',
} as const

export type JevErrorCode = keyof typeof messages

/**
 * A failed Jev call. Messages and details are fixed strings written in this
 * module or schema paths; they never contain email content, provider error
 * bodies, or credentials.
 */
export class JevError extends Error {
  override readonly name = 'JevError'

  constructor(
    readonly code: JevErrorCode,
    /** A content-free description of what was wrong, e.g. a response path. */
    readonly detail: string | null = null,
    readonly httpStatus: number | null = null,
  ) {
    super(detail === null ? messages[code] : `${messages[code]}: ${detail}`)
  }
}
