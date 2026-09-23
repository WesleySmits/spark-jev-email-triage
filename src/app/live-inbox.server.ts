/**
 * The live inbox over any `MailReader`, strictly read-only: it discovers the
 * readable mailboxes, lists a few recent messages in each, one call at a
 * time, and reads one message's body on request. Nothing here writes, and
 * provider errors never reach the browser as more than a coarse reason.
 *
 * Listing reads no thread. Only opening one row does, and that one read can
 * also say what the thread now is: its ids go to the injected `verify`, so
 * this module keeps no knowledge of what is stored about a row, and asks the
 * provider for nothing extra.
 */
import type { z } from 'zod'
import type { emailListingSchema, threadSchema } from '../domain/email'
import type { MailReader, ReadOptions } from '../domain/mail-reader'
import { mailboxCopyId, type MailboxCopyRef } from '../domain/mailbox-copy'
import type { ObservedThread, StoredClassification } from '../domain/stored-classification'
import type { RowReview } from './desk-review'
import { SparkError } from '../spark/errors'
import { inboxSummarySchema, messageBodySchema, type InboxSummary, type MessageBody } from './inbox'
import type { BodyRequest, LiveInbox } from './live-inbox'

type Listing = z.infer<typeof emailListingSchema>
type Thread = z.infer<typeof threadSchema>
type Marker = InboxSummary['account']['marker']

/** Mailboxes listed at most, in the order the provider gives them. */
export const maxMailboxes = 5
/** Recent messages listed per mailbox. */
export const perMailbox = 10

// Only colors: a mailbox's identity is its id, never its marker.
const markers: readonly Marker[] = ['studio', 'atelier', 'personal']

const status = { label: 'Not triaged', tone: 'neutral' } as const

export interface LiveInboxOptions {
  reader: MailReader
  /** IANA zone the times are shown in, e.g. `Europe/Amsterdam`. */
  timeZone: string
  now?: (() => Date) | undefined
  /**
   * What the thread a body read just returned proves about the judgment
   * stored for that copy, and what a person decided about that judgment.
   * Left out, a body carries neither. It must read no provider; a body is
   * never held up for it.
   */
  verify?: ((observed: ObservedThread) => VerifiedRow) | undefined
}

/** What `verify` answers: the judgment for a copy, and any review of it. */
export type VerifiedRow = Readonly<{
  classification: StoredClassification
  review?: RowReview | undefined
}>

/** Why a read failed, without anything the provider said. */
export function reasonFor(error: unknown): Extract<LiveInbox, { status: 'unavailable' }>['reason'] {
  if (!(error instanceof SparkError)) return 'failed'
  if (error.code === 'not_installed') return 'missing'
  return error.code === 'malformed_output' ? 'malformed' : 'failed'
}

const loopback = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])

/**
 * Whether a request came from this computer. Spark reads the mail of the
 * Mac it runs on, so no other machine may ask for it. Unknown is no.
 */
export const isLoopback = (ip: string | undefined) => ip !== undefined && loopback.has(ip)

/** A body read that failed. Its message is fixed, so it is safe to send. */
export class BodyUnavailableError extends Error {
  override readonly name = 'BodyUnavailableError'
  constructor() {
    super('The message could not be read')
  }
}

export function createLiveInbox({
  reader,
  timeZone,
  now = () => new Date(),
  verify,
}: LiveInboxOptions) {
  const format = timeFormats(timeZone)
  /** The mailbox copies the last list offered, by copy id. Bodies are read only for these. */
  let offered = new Set<string>()
  /** Counts list reads, so only the latest one decides what is offered. */
  let reads = 0

  const list = async (options?: ReadOptions): Promise<LiveInbox> => {
    // Nothing is offered while a list reads, and a list that fails offers
    // nothing, so an older list's bodies stay closed.
    const read = ++reads
    offered = new Set()
    try {
      const mailboxes = (await reader.listMailboxes(options))
        .filter((access) => access.canRead)
        .slice(0, maxMailboxes)
        .map(({ mailbox }, index) => ({
          id: mailbox.id,
          account: markerAt(index),
          label: mailbox.address,
        }))
      const listed: Listed[] = []
      for (const mailbox of mailboxes) {
        const request = { mailboxId: mailbox.id, limit: perMailbox }
        const listings = await reader.listRecentEmails(request, options)
        listed.push(...listings.map((listing) => ({ listing, mailbox })))
      }
      const at = now()
      const messages = newestFirst(unique(listed)).map(({ listing, mailbox }) =>
        summarize(listing, mailbox, format.listed(listing.date, at)),
      )
      if (read === reads) offered = new Set(messages.map((message) => message.id))
      return { status: 'ready', readAt: format.clock(at), mailboxes, messages }
    } catch (error) {
      return { status: 'unavailable', reason: reasonFor(error) }
    }
  }

  /**
   * The plain-text body of one listed mailbox copy, named by its copy id,
   * `null` when it has none. It is read through the mailbox it was listed
   * in. A copy the last list didn't offer is listed again first, e.g. after
   * a restart; if it still isn't there, the read fails. The one thread this
   * read returns is also what `verify` judges the stored classification
   * against, so opening a row costs no extra provider call.
   */
  const body = async ({ mailbox, id }: BodyRequest, options?: ReadOptions) => {
    try {
      const ref: MailboxCopyRef = { mailboxId: mailbox, messageId: id }
      const copyId = mailboxCopyId(ref)
      if (!offered.has(copyId)) await list(options)
      if (!offered.has(copyId)) throw new BodyUnavailableError()
      return bodyOf(await reader.readThread(ref, options), ref, verify)
    } catch {
      throw new BodyUnavailableError()
    }
  }

  return { list, body } as const
}

/**
 * What one read thread holds for the copy it was read for: that message's
 * text, `null` when it has none, what the thread proves about the judgment
 * stored for the row, and what a person decided about that judgment.
 */
function bodyOf(thread: Thread, ref: MailboxCopyRef, verify: LiveInboxOptions['verify']) {
  const text = thread.messages.find((message) => message.id === ref.messageId)?.bodyText ?? null
  if (text === null) return null
  const found = evidence(verify, {
    copy: ref,
    threadId: thread.id,
    latestMessageId: thread.messages.at(-1)?.id ?? thread.id,
  })
  return messageBodySchema.parse({
    id: mailboxCopyId(ref),
    text,
    ...(found && { classification: found.classification }),
    ...(found?.review && { review: found.review }),
  } satisfies MessageBody)
}

/**
 * What `verify` makes of one read thread. Evidence about a row is
 * supplemental: a lookup that fails leaves the body it belongs to alone.
 */
function evidence(verify: LiveInboxOptions['verify'], observed: ObservedThread) {
  try {
    return verify?.(observed)
  } catch {
    return undefined
  }
}

const markerAt = (index: number): Marker => markers[index % markers.length] ?? 'studio'

type ShownMailbox = Readonly<{ id: string; account: Marker; label: string }>
/** A listing with the mailbox it was listed in. */
type Listed = Readonly<{ listing: Listing; mailbox: ShownMailbox }>

/** Listed text as the row shows it: a cut value ends in `…`, a missing one is `null`. */
const shown = (value: Listing['subject']) => value && (value.cut ? `${value.text}…` : value.text)

/** One strict queue row for a listing. Lists can cut values, so some end in `…`. */
function summarize(
  listing: Listing,
  mailbox: ShownMailbox,
  time: Pick<InboxSummary, 'time' | 'dateTime'>,
): InboxSummary {
  return inboxSummarySchema.parse({
    id: mailboxCopyId({ mailboxId: mailbox.id, messageId: listing.messageId }),
    messageId: listing.messageId,
    workflow: 'inbox',
    mailbox: mailbox.id,
    sender: shown(listing.sender) ?? 'Sender unavailable',
    ...(listing.from && { address: listing.from.address }),
    ...time,
    subject: shown(listing.subject) ?? 'Subject unavailable',
    snippet: '',
    account: { marker: mailbox.account, label: mailbox.label },
    status,
  })
}

/**
 * The first listing of each mailbox copy. One message id in two mailboxes,
 * e.g. a delivery to two aliases, is two copies, and both stay.
 */
function unique(listed: readonly Listed[]) {
  const seen = new Set<string>()
  return listed.filter(({ listing, mailbox }) => {
    const copyId = mailboxCopyId({ mailboxId: mailbox.id, messageId: listing.messageId })
    if (seen.has(copyId)) return false
    seen.add(copyId)
    return true
  })
}

/** Newest first; messages without a date go last. Ties keep the listing order. */
function newestFirst(listed: readonly Listed[]) {
  const time = ({ listing }: Listed) =>
    listing.date === null ? Number.MIN_SAFE_INTEGER : Date.parse(listing.date)
  return [...listed].sort((a, b) => time(b) - time(a))
}

const dayMs = 24 * 60 * 60 * 1000

/** How times show: today as "09:42", this week as "Mon", else "14 Sep" or "14 Sep 2025". */
function timeFormats(timeZone: string) {
  const clock = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit' })
  const day = new Intl.DateTimeFormat('en-CA', { timeZone, dateStyle: 'short' })
  const weekday = new Intl.DateTimeFormat('en-GB', { timeZone, weekday: 'short' })
  const date = new Intl.DateTimeFormat('en-GB', { timeZone, day: 'numeric', month: 'short' })
  const dated = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
  const year = (at: Date) => day.format(at).slice(0, 4)
  const visible = (at: Date, now: Date) => {
    if (day.format(at) === day.format(now)) return clock.format(at)
    const age = now.getTime() - at.getTime()
    if (age > 0 && age < 6 * dayMs) return weekday.format(at)
    return (year(at) === year(now) ? date : dated).format(at)
  }
  return {
    clock: (at: Date) => clock.format(at),
    /** The row's `time` and `dateTime`; an unknown date shows no time. */
    listed: (iso: string | null, now: Date) =>
      iso === null ? { time: '' } : { time: visible(new Date(iso), now), dateTime: iso },
  }
}
