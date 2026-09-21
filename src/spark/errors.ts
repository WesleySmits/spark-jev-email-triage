const messages = {
  invalid_input: 'Spark request input is invalid',
  not_installed: 'The spark executable was not found',
  spawn_failed: 'The spark executable could not be started',
  aborted: 'The Spark call was cancelled',
  timeout: 'The Spark call timed out',
  output_too_large: 'Spark output exceeded the size limit',
  exit_failure: 'Spark exited with an error',
  malformed_output: 'Spark output could not be parsed',
} as const

export type SparkErrorCode = keyof typeof messages

/**
 * A failed Spark call. Messages and details are fixed strings written in
 * this module; they never contain Spark output or mailbox content.
 */
export class SparkError extends Error {
  override readonly name = 'SparkError'

  constructor(
    readonly code: SparkErrorCode,
    /** A content-free description of what was wrong, e.g. which field. */
    readonly detail: string | null = null,
    readonly exitCode: number | null = null,
  ) {
    super(detail === null ? messages[code] : `${messages[code]}: ${detail}`)
  }
}

export const malformed = (detail: string) => new SparkError('malformed_output', detail)
