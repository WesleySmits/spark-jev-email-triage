/**
 * What the browser gets of the live inbox, and how it asks for one body.
 * Browser-safe: this module imports no server code. The server side is
 * `live-inbox.server.ts`, reached only through `live-inbox.functions.ts`.
 */
import { z } from 'zod'
import type { SidebarItem } from '../components/organisms/Sidebar/Sidebar'
import type { StoredClassification } from '../domain/stored-classification'
import type { RowReview } from './desk-review'
import type { BodyLoader, InboxSummary, MessageBody } from './inbox'

/** Live mail isn't triaged yet, so every message is in one workflow. */
export const liveWorkflows: readonly SidebarItem[] = [
  { id: 'inbox', icon: 'inbox', label: 'Recent mail' },
]

/**
 * How much of one mailbox a reading holds. Counted from the rows it kept,
 * so it says what is there, never what the mailbox holds.
 */
export type MailboxScope = Readonly<{
  /** The mailbox id, as every row's `mailbox` names it. */
  id: string
  /** The address the rail shows for it. */
  label: string
  /** Rows this reading holds for that mailbox. */
  loaded: number
  /**
   * Whether the per-mailbox bound may have cut it: the provider returned as
   * many messages as were asked for, so there may be more it was never
   * asked for. Nothing here counts or guesses what was not loaded.
   */
  bounded: boolean
}>

/**
 * One listed mailbox this reading could not read, and how coarsely it went
 * wrong. It names the mailbox and nothing it holds: no sender, subject,
 * message id or provider text ever reaches the browser through here.
 */
export type MailboxFailure = Readonly<{
  /** The mailbox id, as the rail and every row's `mailbox` name it. */
  id: string
  /** The address the rail shows for it. */
  label: string
  /**
   * Why it could not be read. The same coarse reasons an unavailable
   * reading gives, minus `local-only`, which decides a whole request.
   */
  reason: 'missing' | 'failed' | 'malformed'
}>

/**
 * What one reading of the inbox actually holds, what bounded it, and what it
 * could not read. It is the honest answer to "is this the mailbox?": no, it
 * is this many recent Inbox messages from these mailboxes, read at this time.
 *
 * Every figure is counted from what was read. `readable` is how many
 * mailboxes the provider offered before the mailbox bound applied, which is
 * the one thing a reading learns about mail it did not load.
 */
export type InboxScope = Readonly<{
  /**
   * The mailboxes this reading listed, in provider order. A mailbox that
   * failed stays here, so the rail and the mailbox filter survive a failure
   * that only cost its rows; `failed` says which ones those are.
   */
  mailboxes: readonly MailboxScope[]
  /**
   * The listed mailboxes that could not be read, in the same order. An empty
   * list means every listed mailbox was read; while this list is shorter than
   * `mailboxes`, the rest of the reading is real mail that was read now.
   *
   * A mailbox here contributes no rows, so its `loaded` is 0 because nothing
   * could be read, never because the mailbox is empty. That difference is
   * why this list exists rather than a count.
   */
  failed: readonly MailboxFailure[]
  /** Readable mailboxes the provider offered, before the mailbox bound. */
  readable: number
  /** At most this many mailboxes are listed. */
  mailboxLimit: number
  /** At most this many recent Inbox messages are listed per mailbox. */
  messageLimit: number
  /** Rows this reading holds across those mailboxes. */
  loaded: number
  /** Whether either bound may have cut this reading. */
  bounded: boolean
  /** When this reading finished, already formatted, e.g. "09:42". */
  readAt: string
  /**
   * Machine-readable form of `readAt`. Every row of this reading was read
   * then, failures included: a mailbox that failed keeps nothing from an
   * earlier reading, so no figure here is older than this instant.
   */
  refreshedAt: string
}>

/**
 * The initial page data: summaries without bodies, or why there are none.
 * `unavailable` never comes with messages, sample or otherwise.
 */
export type LiveInbox =
  | Readonly<{
      status: 'ready'
      /** What this reading holds and what bounded it, including when it was read. */
      scope: InboxScope
      /** The readable mailboxes that were listed, as the rail shows them. */
      mailboxes: readonly SidebarItem[]
      messages: readonly InboxSummary[]
    }>
  | Readonly<{
      status: 'unavailable'
      /**
       * `local-only`: the request didn't come from this computer. `missing`:
       * no Spark here. `failed`: it didn't answer. `malformed`: its output
       * didn't parse.
       */
      reason: 'local-only' | 'missing' | 'failed' | 'malformed'
    }>

/**
 * What shadow triage stored about each listed row, by the row's id. Every
 * listed row has an entry; a row nothing applies to holds `none`.
 */
export type ListedClassifications = Readonly<Record<string, StoredClassification>>

/**
 * What a person decided about each listed row, by the row's id. Only rows
 * someone reviewed are present, and only where that review named the exact
 * classification the row holds; every other row is absent, which is not an
 * error.
 */
export type ListedReviews = Readonly<Record<string, RowReview>>

/**
 * One reading of the desk: the listed inbox, and what is stored about its
 * rows. An inbox that listed nothing carries no judgments either.
 *
 * `reading` names this one reading and nothing else. Every reading, a
 * refresh included, gets its own, so a browser holding an older one can tell
 * that what it proved about a row by reading that row's thread belongs to a
 * reading the desk has moved on from. It is opaque and content-free: it
 * names no mailbox, message or judgment.
 */
export type ClassifiedInbox =
  | (Extract<LiveInbox, { status: 'ready' }> &
      Readonly<{
        reading: string
        classifications: ListedClassifications
        /** What a person made of those judgments, where anyone has. */
        reviews: ListedReviews
      }>)
  | Extract<LiveInbox, { status: 'unavailable' }>

/** One body request: a mailbox copy the server listed, by its mailbox and message id. */
export const bodyRequestSchema = z.strictObject({
  /** The mailbox id as listed. Spark keeps its case, so it isn't lowercased. */
  mailbox: z.email(),
  /** Spark's message id, not the row's `id`. */
  id: z.string().regex(/^[1-9][0-9]{0,18}$/),
})

export type BodyRequest = z.infer<typeof bodyRequestSchema>

type FetchBody = (request: BodyRequest, signal: AbortSignal) => Promise<MessageBody | null>

/**
 * A body loader for the listed messages. For a row it asks `fetchBody` for
 * that row's mailbox copy: its message id, in the mailbox its summary names.
 * A row it wasn't given, or one without a message id, resolves to `null`
 * without asking.
 */
export function liveBodyLoader(
  messages: readonly InboxSummary[],
  fetchBody: FetchBody,
): BodyLoader {
  const copies = new Map<string, BodyRequest>()
  for (const { id, mailbox, messageId } of messages) {
    if (messageId !== undefined) copies.set(id, { mailbox, id: messageId })
  }
  return (id, { signal }) => {
    const copy = copies.get(id)
    return copy === undefined ? Promise.resolve(null) : fetchBody(copy, signal)
  }
}
