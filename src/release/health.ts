/**
 * What a running server can prove about itself: the commit it was built
 * from, and nothing else.
 *
 * Health answers one question only — which code is deployed here — because
 * that is the question a release needs answered before anything else. It
 * reads no mailbox, calls no provider and opens no database, so it says
 * nothing at all about whether Spark answers: `pnpm readback:spark` is that
 * check, deliberately apart from this one.
 *
 * A build that cannot name its commit is not healthy. Naming it is the
 * point: an unidentified build is one nobody can roll back to a known
 * commit, so it is reported as unidentified rather than quietly as ok.
 */

/** The environment variable a build's commit is read from. */
export const commitVariable = 'APP_COMMIT_SHA'

/** A full Git object name, which is the only form accepted as proof. */
const commitSha = /^[0-9a-f]{40}$/

/** Why a build cannot be identified, without echoing what was set. */
export type UnidentifiedReason = 'unset' | 'malformed'

/**
 * One health answer. It holds a commit and nothing more: no mailbox,
 * address, subject, count or configuration value, so it may be logged,
 * pasted and served to any monitor.
 */
export type Health =
  | Readonly<{ status: 'ok'; commit: string }>
  | Readonly<{ status: 'unidentified'; reason: UnidentifiedReason }>

/** The health of a build whose commit was set to `value`, if it was set. */
export function healthFor(value: string | undefined): Health {
  const commit = value?.trim() ?? ''
  if (commit === '') return { status: 'unidentified', reason: 'unset' }
  if (!commitSha.test(commit)) return { status: 'unidentified', reason: 'malformed' }
  return { status: 'ok', commit }
}

/**
 * The HTTP status for an answer. Unidentified is `503`: the server runs,
 * but a deployment nobody can name is not one to send traffic to.
 */
export const healthStatusCode = (health: Health) => (health.status === 'ok' ? 200 : 503)
