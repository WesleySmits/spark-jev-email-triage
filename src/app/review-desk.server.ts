/**
 * One reading of the review desk: the mail the live inbox listed, what
 * shadow triage stored about each row it listed, and what a person made of
 * that, so a saved review is there again after a refresh.
 *
 * Both halves only read. The mailbox is read through the shared Spark
 * reader, the judgments come from the local shadow database read-only, and
 * nothing here calls a classifier: opening or refreshing the page never
 * classifies. A reading that lists no mail carries no judgments either.
 *
 * Every reading is named, so nothing an earlier one proved is taken for
 * proof under a later one. Refreshing lists the mailbox again, and the
 * provider may have moved on since; only reading a thread again can say.
 */
import { randomUUID } from 'node:crypto'
import type { ReadOptions } from '../domain/mail-reader'
import type {
  ClassifiedDiscovery,
  ClassifiedInbox,
  ClassifiedRefresh,
  InboxDiscoveryRequest,
  InboxListRequest,
  InboxRefreshRequest,
} from './live-inbox'
import { sparkInbox } from './spark-inbox.server'
import { storedRowsFor } from './stored-classifications.server'

export async function deskReading(
  options?: ReadOptions,
  request?: InboxListRequest,
): Promise<ClassifiedInbox> {
  const inbox = await sparkInbox().list(options, request)
  if (inbox.status !== 'ready') return inbox
  // One id per reading, minted here because this is where a listing and the
  // judgments stored for it become one reading. It lets a browser tell a
  // proof that belongs to this reading from one an earlier reading made.
  return { ...inbox, reading: randomUUID(), ...storedRowsFor(inbox.messages) }
}

/** One controlled metadata search with the stored state of its matching copies. */
export async function deskDiscovery(
  request: InboxDiscoveryRequest,
  options?: ReadOptions,
): Promise<ClassifiedDiscovery> {
  const inbox = await sparkInbox().search(request, options)
  if (inbox.status !== 'ready') return inbox
  return { ...inbox, reading: randomUUID(), ...storedRowsFor(inbox.messages) }
}

/** Re-reads the loaded view and joins its rows to locally stored state. */
export async function deskRefresh(
  request: InboxRefreshRequest,
  options?: ReadOptions,
): Promise<ClassifiedRefresh> {
  const inbox = await sparkInbox().refresh(request, options)
  if (inbox.status !== 'ready') return inbox
  return { ...inbox, reading: randomUUID(), ...storedRowsFor(inbox.messages) }
}
