/**
 * The live inbox over any `MailReader`, strictly read-only: it discovers the
 * readable mailboxes, lists a few recent messages in each, one call at a
 * time, and reads one message's body on request. Nothing here writes, and
 * provider errors never reach the browser as more than a coarse reason.
 */
import type { z } from 'zod'
import type { emailListingSchema } from '../domain/email'
import type { MailReader, ReadOptions } from '../domain/mail-reader'
import { SparkError } from '../spark/errors'
import { inboxSummarySchema, messageBodySchema, type InboxSummary, type MessageBody } from './inbox'
import type { BodyRequest, LiveInbox } from './live-inbox'

type Listing = z.infer<typeof emailListingSchema>
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
}

/** Why a read failed, without anything the provider said. */
function reasonFor(error: unknown): Extract<LiveInbox, { status: 'unavailable' }>['reason'] {
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

export function createLiveInbox({ reader, timeZone, now = () => new Date() }: LiveInboxOptions) {
  const format = timeFormats(timeZone)
  /** The messages the last list offered, as `mailbox id`. Bodies are read only for these. */
  let offered = new Set<string>()
  const key = (mailbox: string, id: string) => `${mailbox} ${id}`

  const list = async (options?: ReadOptions): Promise<LiveInbox> => {
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
      offered = new Set(messages.map((message) => key(message.mailbox, message.id)))
      return { status: 'ready', readAt: format.clock(at), mailboxes, messages }
    } catch (error) {
      return { status: 'unavailable', reason: reasonFor(error) }
    }
  }

  /**
   * The plain-text body of one listed message, `null` when it has none.
   * A message the last list didn't offer is listed again first, e.g. after
   * a restart; if it still isn't there, the read fails.
   */
  const body = async ({ mailbox, id }: BodyRequest, options?: ReadOptions) => {
    try {
      if (!offered.has(key(mailbox, id))) await list(options)
      if (!offered.has(key(mailbox, id))) throw new BodyUnavailableError()
      const thread = await reader.readThread({ mailboxId: mailbox, messageId: id }, options)
      const text = thread.messages.find((message) => message.id === id)?.bodyText ?? null
      return text === null ? null : messageBodySchema.parse({ id, text } satisfies MessageBody)
    } catch {
      throw new BodyUnavailableError()
    }
  }

  return { list, body } as const
}

const markerAt = (index: number): Marker => markers[index % markers.length] ?? 'studio'

type ShownMailbox = Readonly<{ id: string; account: Marker; label: string }>
/** A listing with the mailbox it was listed in. */
type Listed = Readonly<{ listing: Listing; mailbox: ShownMailbox }>

/** One strict queue row for a listing. Lists can cut values, so some show as unavailable. */
function summarize(
  listing: Listing,
  mailbox: ShownMailbox,
  time: Pick<InboxSummary, 'time' | 'dateTime'>,
): InboxSummary {
  return inboxSummarySchema.parse({
    id: listing.messageId,
    workflow: 'inbox',
    mailbox: mailbox.id,
    sender: listing.from?.name ?? listing.from?.address ?? 'Sender unavailable',
    ...(listing.from && { address: listing.from.address }),
    ...time,
    subject: listing.subject ?? 'Subject unavailable',
    snippet: '',
    account: { marker: mailbox.account, label: mailbox.label },
    status,
  })
}

/** The first listing of each message; one message can show in two mailboxes. */
function unique(listed: readonly Listed[]) {
  const seen = new Set<string>()
  return listed.filter(({ listing }) => {
    if (seen.has(listing.messageId)) return false
    seen.add(listing.messageId)
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
