/**
 * A deterministic version of one parsed thread, used to pin a candidate
 * expectation to the exact mail it was written against.
 *
 * A subject line and a latest message id are too little to pin on.
 * `classificationSubjectSchema` freezes a whole snapshot for the same
 * reason: a judgment is about everything that was read. A changed body, a
 * renamed sender, a different attachment or an edited earlier message can
 * all leave the subject and the message ids untouched while making the
 * labels wrong, so the digest covers the parsed thread whole.
 *
 * Keys are sorted at every depth before hashing, so the value follows the
 * thread's content rather than the order a schema happens to declare its
 * fields. The digest detects drift; it is not a security boundary.
 */
import { createHash } from 'node:crypto'
import type { z } from 'zod'
import type { threadSchema } from '../domain/email'

/** JSON with object keys in one fixed order at every depth. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const fields = Object.entries(value)
      .sort(([left], [right]) => (left < right ? -1 : 1))
      .map(([key, each]) => `${JSON.stringify(key)}:${canonical(each)}`)
    return `{${fields.join(',')}}`
  }
  return JSON.stringify(value)
}

/** The first 16 hex characters of the SHA-256 of the canonical thread. */
export const threadDigest = (thread: z.infer<typeof threadSchema>) =>
  createHash('sha256').update(canonical(thread)).digest('hex').slice(0, 16)
