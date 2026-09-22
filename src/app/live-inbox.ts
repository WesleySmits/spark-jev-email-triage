/**
 * What the browser gets of the live inbox, and how it asks for one body.
 * Browser-safe: this module imports no server code. The server side is
 * `live-inbox.server.ts`, reached only through `live-inbox.functions.ts`.
 */
import { z } from 'zod'
import type { SidebarItem } from '../components/organisms/Sidebar/Sidebar'
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

/** One body request: a message the server listed, in the mailbox it was listed in. */
export const bodyRequestSchema = z.strictObject({
  /** The mailbox id as listed. Spark keeps its case, so it isn't lowercased. */
  mailbox: z.email(),
  id: z.string().regex(/^[1-9][0-9]{0,18}$/),
})

export type BodyRequest = z.infer<typeof bodyRequestSchema>

type FetchBody = (request: BodyRequest, signal: AbortSignal) => Promise<MessageBody | null>

/**
 * A body loader for the listed messages. It asks `fetchBody` for one
 * message, in the mailbox its summary names; an id it wasn't given resolves
 * to `null` without asking.
 */
export function liveBodyLoader(
  messages: readonly InboxSummary[],
  fetchBody: FetchBody,
): BodyLoader {
  const mailboxes = new Map(messages.map((message) => [message.id, message.mailbox]))
  return (id, { signal }) => {
    const mailbox = mailboxes.get(id)
    return mailbox === undefined ? Promise.resolve(null) : fetchBody({ mailbox, id }, signal)
  }
}
