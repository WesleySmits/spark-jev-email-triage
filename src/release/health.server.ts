/**
 * The health endpoint's server side. It reads one environment variable and
 * answers with `health.ts`'s judgment of it. Nothing else is read: no
 * request body, no header, no mailbox and no database.
 */
import { commitVariable, healthFor, healthStatusCode, type Health } from './health'

/** The health answer as a response. Never cached: it is true for a moment. */
export function healthResponse(env: NodeJS.ProcessEnv): Response {
  const health: Health = healthFor(env[commitVariable])
  return new Response(JSON.stringify(health), {
    status: healthStatusCode(health),
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  })
}
