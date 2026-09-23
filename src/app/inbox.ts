/**
 * What the browser may hold of an inbox: one summary per queue row, and the
 * body of one message only once it is opened. Browser-safe: this module
 * imports no server code, and nothing here reads or changes a mailbox.
 *
 * Invariants:
 * - A summary never carries a body. Objects are strict, so a body or any
 *   other extra field is rejected instead of passing through.
 * - A body names the message it belongs to, so a response for another
 *   message is never shown.
 * - A body may carry what the thread its read returned proves about the
 *   judgment stored for that row, and what a person decided about that
 *   judgment. Both are evidence about the row, never a new judgment: nothing
 *   classifies to answer a body read, and no review is written by one.
 */
import { z } from 'zod'
import { storedClassificationSchema } from '../domain/stored-classification'
import { rowReviewSchema } from './desk-review'

const id = z.string().trim().min(1)

export const inboxSummarySchema = z.strictObject({
  /**
   * The row's own identity, unique in the queue. For provider mail it names
   * the mailbox copy, so one message id listed in two mailboxes is two rows.
   */
  id,
  /** The provider's id for the message in `mailbox`. Sample mail has none. */
  messageId: id.optional(),
  /** Id of the workflow the message is in, e.g. `review`. */
  workflow: id,
  /** Id of the mailbox the message was listed in. `account` only shows it. */
  mailbox: id,
  sender: z.string(),
  /** The sender's address, shown in the reader. */
  address: z.string().optional(),
  /** Visible time, already formatted, e.g. "09:42" or "Mon". */
  time: z.string(),
  /** Machine-readable form of `time`. */
  dateTime: z.string().optional(),
  subject: z.string(),
  /** A short preview. It is all the queue and its search see of the text. */
  snippet: z.string(),
  /** How the mailbox shows: a marker color and its always visible name. */
  account: z.strictObject({
    marker: z.enum(['studio', 'atelier', 'personal']),
    label: z.string(),
  }),
  status: z.strictObject({
    label: z.string(),
    tone: z.enum(['neutral', 'review', 'done']),
  }),
  category: z.string().optional(),
  unread: z.boolean().optional(),
})

/** One queue row. Holds no body. */
export type InboxSummary = z.infer<typeof inboxSummarySchema>

export const messageBodySchema = z.strictObject({
  /** The row this body belongs to: its summary's `id`. */
  id,
  /** Plain text. A blank line starts a new paragraph. */
  text: z.string(),
  /**
   * What the stored judgment for this row says, now that a thread was read
   * for it. Absent when no judgment was looked up at all, as for fixtures.
   */
  classification: storedClassificationSchema.optional(),
  /**
   * What a person decided about that judgment, where anyone has. Only sent
   * beside a `classification`, because a review decides a row through the
   * classification it named and never on its own.
   */
  review: rowReviewSchema.optional(),
})

export type MessageBody = z.infer<typeof messageBodySchema>

/**
 * Loads one message's body when it opens. Resolves to `null` when the
 * message has no body to show; rejects when the provider fails. It must
 * stop, or at least be ignored, once `signal` aborts.
 */
export type BodyLoader = (
  id: string,
  options: Readonly<{ signal: AbortSignal }>,
) => Promise<MessageBody | null>

/** A fixture: a summary with its body, as sample data is written. */
export type InboxFixture = InboxSummary & Readonly<{ body: string | null }>

/**
 * Splits fixtures into the summaries the queue gets and the bodies a loader
 * hands out one at a time. Every summary is checked against the schema.
 */
export function splitFixtures(fixtures: readonly InboxFixture[]) {
  const bodies = new Map<string, string | null>()
  const summaries = fixtures.map(({ body, ...summary }) => {
    bodies.set(summary.id, body)
    return inboxSummarySchema.parse(summary)
  })
  return { summaries, bodies } as const
}

type FixtureLoaderOptions = Readonly<{
  /** Milliseconds before a body arrives. Left out: on the next tick. */
  delay?: ((id: string) => number) | undefined
  /** Ids whose load fails, as when the provider is unreachable. */
  failing?: ReadonlySet<string> | undefined
}>

function wait(delay: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, delay)
    signal.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(signal.reason as Error)
    })
  })
}

/**
 * A body loader over fixture bodies, for the demo, stories and tests. An id
 * without a body, or one it doesn't know, resolves to `null`.
 */
export function fixtureBodyLoader(
  bodies: ReadonlyMap<string, string | null>,
  { delay, failing }: FixtureLoaderOptions = {},
): BodyLoader {
  return async (id, { signal }) => {
    await wait(delay?.(id) ?? 0, signal)
    if (failing?.has(id)) throw new Error('The mail provider is unavailable')
    const text = bodies.get(id) ?? null
    return text === null ? null : messageBodySchema.parse({ id, text })
  }
}
