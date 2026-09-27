/**
 * Reading back the result one Save request was already given.
 *
 * Reviews and recorded work decisions are both written that way: the row and
 * its result commit together, and a retry under the same request id reads
 * what that id answered instead of writing a second time. The part that has
 * to match between them is here, so the two cannot drift apart on it:
 * a request nobody has seen, a request id reused for different content, and
 * a refusal that was recorded as the answer.
 *
 * Each caller keeps its own table, its own query and its own idea of what a
 * recorded result holds; this decides only whether there is one to read.
 */
import { z } from 'zod'

const requestRowSchema = z.object({
  payload: z.string(),
  status: z.enum(['recorded', 'refused']),
  refusal_reason: z.string().nullable(),
})

/**
 * What one stored request says, before the caller reads what it recorded:
 * - `absent`: this database has never answered that request id.
 * - `refused`: the id was answered with a refusal, which is what it keeps
 *   answering, or it was reused for different content.
 * - `recorded`: something was stored for it, and the caller reads what.
 */
export type RequestOutcome<Reason> =
  | Readonly<{ status: 'absent' }>
  | Readonly<{ status: 'refused'; reason: Reason | 'request_conflict' }>
  | Readonly<{ status: 'recorded' }>

/** Any schema that reads one refusal code this caller knows. */
interface RefusalSchema<Reason> {
  parse: (value: unknown) => Reason
}

/**
 * What the row a request query returned says about that request. `payload`
 * is the content the caller is asking about: a row holding anything else was
 * written for a different request under the same id, which is a conflict
 * rather than a repeat, so nothing of either is read as the other's result.
 */
export function requestOutcome<Reason>(
  raw: unknown,
  payload: string,
  refusal: RefusalSchema<Reason>,
): RequestOutcome<Reason> {
  if (raw === undefined) return { status: 'absent' }
  const row = requestRowSchema.parse(raw)
  if (row.payload !== payload) return { status: 'refused', reason: 'request_conflict' }
  if (row.status === 'refused') {
    return { status: 'refused', reason: refusal.parse(row.refusal_reason) }
  }
  return { status: 'recorded' }
}
