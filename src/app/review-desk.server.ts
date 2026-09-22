/**
 * One reading of the review desk: the mail the live inbox listed, and what
 * shadow triage stored about each row it listed.
 *
 * Both halves only read. The mailbox is read through the shared Spark
 * reader, the judgments come from the local shadow database read-only, and
 * nothing here calls a classifier: opening or refreshing the page never
 * classifies. A reading that lists no mail carries no judgments either.
 */
import type { ReadOptions } from '../domain/mail-reader'
import type { ClassifiedInbox } from './live-inbox'
import { sparkInbox } from './spark-inbox.server'
import { classificationsFor } from './stored-classifications.server'

export async function deskReading(options?: ReadOptions): Promise<ClassifiedInbox> {
  const inbox = await sparkInbox().list(options)
  if (inbox.status !== 'ready') return inbox
  return { ...inbox, classifications: classificationsFor(inbox.messages) }
}
