/**
 * What the browser gets of the live inbox, and how it asks for one body.
 * Browser-safe: this module imports no server code. The server side is
 * `live-inbox.server.ts`, reached only through `live-inbox.functions.ts`.
 */
import { z } from 'zod'
import type { SidebarItem } from '../components/organisms/Sidebar/Sidebar'
import type { StoredClassification } from '../domain/stored-classification'
import type { BodyLoader, InboxSummary, MessageBody } from './inbox'

/** Live mail isn't triaged yet, so every message is in one workflow. */
export const liveWorkflows: readonly SidebarItem[] = [
  { id: 'inbox', icon: 'inbox', label: 'Recent mail' },
]

/**
 * The initial page data: summaries without bodies, or why there are none.
 * `unavailable` never comes with messages, sample or otherwise.
 */
export type LiveInbox =
  | Readonly<{
      status: 'ready'
      /** When the list was read, already formatted, e.g. "09:42". */
      readAt: string
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
      Readonly<{ reading: string; classifications: ListedClassifications }>)
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
