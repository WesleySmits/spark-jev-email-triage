/**
 * The live inbox over any `MailReader`, strictly read-only: it discovers the
 * readable mailboxes, lists a few recent messages in each, one call at a
 * time, and reads one message's body on request. Nothing here writes, and
 * provider errors never reach the browser as more than a coarse reason.
 *
 * A failure is as small as what it cost. Discovering the mailboxes is the
 * one all-or-nothing step, because a reading that does not know its
 * mailboxes cannot say what it holds; that failure is `unavailable`. After
 * it, each mailbox is listed on its own: one that fails costs its own rows
 * and is named in the scope, and the mailboxes read before and after it are
 * still delivered. So a reading reports what it read and what it could not,
 * never one in place of the other.
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
import type {
  BodyRequest,
  InboxListRequest,
  InboxScope,
  LiveInbox,
  MailboxFailure,
} from './live-inbox'
import { maxInboxPages } from './live-inbox'

type Listing = z.infer<typeof emailListingSchema>
type Thread = z.infer<typeof threadSchema>
type Marker = InboxSummary['account']['marker']

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

/**
 * Why a read failed, without anything the provider said. It is the reason a
 * whole reading gives and the reason one mailbox gives, so both stay coarse:
 * `local-only` is not among them, because that decides a request, not a read.
 */
export function reasonFor(error: unknown): MailboxFailure['reason'] {
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
  let lastRequest: InboxListRequest = { view: 'unread', pages: 1 }
  /** Counts list reads, so only the latest one decides what is offered. */
  let reads = 0

  const list = async (
    options?: ReadOptions,
    request: InboxListRequest = { view: 'unread', pages: 1 },
  ): Promise<LiveInbox> => {
    // Nothing is offered while a list reads, and a list that fails offers
    // nothing, so an older list's bodies stay closed.
    const read = ++reads
    offered = new Set()
    lastRequest = request
    try {
      const readable = (await reader.listMailboxes(options)).filter((access) => access.canRead)
      const mailboxes = readable.map(({ mailbox }, index) => ({
        id: mailbox.id,
        account: markerAt(index),
        label: mailbox.address,
      }))
      const listed: Listed[] = []
      // Whether a mailbox gave back as many messages as it was asked for, so
      // the bound may have cut it. Counted per mailbox, before anything drops.
      const atLimit = new Map<string, boolean>()
      const failed: MailboxFailure[] = []
      const incomplete: MailboxFailure[] = []
      // Still one mailbox at a time: isolating a failure must not turn these
      // reads into concurrent Spark commands. One that fails costs its own
      // rows and nothing else, so the mailboxes after it are still read.
      const pages = Math.min(Math.max(Math.trunc(request.pages), 1), maxInboxPages)
      for (const mailbox of mailboxes) {
        try {
          const result = await readMailboxPages(reader, mailbox.id, pages, request.view, options)
          listed.push(...result.listings.map((listing) => ({ listing, mailbox })))
          atLimit.set(mailbox.id, result.bounded)
          if (result.error) {
            incomplete.push({
              id: mailbox.id,
              label: mailbox.label,
              reason: reasonFor(result.error),
            })
          }
        } catch (error) {
          // A caller that gave up wants no more commands run for it, so an
          // abort ends the whole read rather than being reported as a mailbox
          // that could not be read.
          if (options?.signal?.aborted === true) throw error
          failed.push({ id: mailbox.id, label: mailbox.label, reason: reasonFor(error) })
        }
      }
      const at = now()
      const messages = newestFirst(unique(listed)).map(({ listing, mailbox }) =>
        summarize(listing, mailbox, format.listed(listing.date, at)),
      )
      if (read === reads) offered = new Set(messages.map((message) => message.id))
      const scope = scopeOf({
        mailboxes,
        messages,
        readable: readable.length,
        view: request.view,
        pages,
        atLimit,
        failed,
        incomplete,
        at,
        format,
      })
      return { status: 'ready', scope, mailboxes, messages }
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
  const body = async ({ mailbox, id, selection }: BodyRequest, options?: ReadOptions) => {
    try {
      const ref: MailboxCopyRef = { mailboxId: mailbox, messageId: id }
      const copyId = mailboxCopyId(ref)
      if (!offered.has(copyId)) await list(options, selection ?? lastRequest)
      if (!offered.has(copyId)) throw new BodyUnavailableError()
      return bodyOf(await reader.readThread(ref, options), ref, verify)
    } catch {
      throw new BodyUnavailableError()
    }
  }

  return { list, body } as const
}

/** Keep completed pages if a later page fails, without hiding the incomplete read. */
async function readMailboxPages(
  reader: MailReader,
  mailboxId: string,
  pages: number,
  view: InboxListRequest['view'],
  options?: ReadOptions,
) {
  const listings: Listing[] = []
  let bounded = false
  for (let page = 1; page <= pages; page += 1) {
    try {
      const rows = await reader.listRecentEmails(
        { mailboxId, limit: perMailbox, page, filter: view === 'unread' ? 'is:unread' : 'is:read' },
        options,
      )
      listings.push(...rows)
      bounded = rows.length >= perMailbox
      if (!bounded) break
    } catch (error) {
      if (page === 1 || options?.signal?.aborted) throw error
      return { listings, bounded: true, error }
    }
  }
  return { listings, bounded, error: undefined }
}

/**
 * What one read thread holds for the copy it was read for: that message's
 * text, `null` when it has none, what the thread proves about the judgment
 * stored for the row, and what a person decided about that judgment.
 */
function bodyOf(thread: Thread, ref: MailboxCopyRef, verify: LiveInboxOptions['verify']) {
  const text = thread.messages.find((message) => message.id === ref.messageId)?.bodyText ?? null
  if (text === null) return null
  const latestMessageId = thread.messages.at(-1)?.id ?? thread.id
  const found = evidence(verify, {
    copy: ref,
    threadId: thread.id,
    latestMessageId,
  })
  return messageBodySchema.parse({
    id: mailboxCopyId(ref),
    text,
    thread: { threadId: thread.id, latestMessageId },
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

type ScopeInput = Readonly<{
  mailboxes: readonly ShownMailbox[]
  messages: readonly InboxSummary[]
  /** Readable mailboxes the provider offered, before the mailbox bound. */
  readable: number
  view: InboxListRequest['view']
  pages: number
  /** Per mailbox: whether its listing came back at the per-mailbox bound. */
  atLimit: ReadonlyMap<string, boolean>
  /** The listed mailboxes whose listing failed, so they hold no rows here. */
  failed: readonly MailboxFailure[]
  incomplete: readonly MailboxFailure[]
  at: Date
  format: ReturnType<typeof timeFormats>
}>

/**
 * What this reading holds, counted from the rows it kept. A mailbox copy is
 * one row, so one message delivered to a primary address and an alias counts
 * in both mailboxes: nothing here merges copies to make a figure smaller.
 *
 * A mailbox that failed is still listed, with the 0 rows it actually
 * contributed, and named in `failed`. It is never reported as bounded: a
 * listing that never arrived proves nothing about what the bound would have
 * cut, and calling it empty would claim its mailbox holds no mail.
 */
function scopeOf({
  mailboxes,
  messages,
  readable,
  view,
  pages,
  atLimit,
  failed,
  incomplete,
  at,
  format,
}: ScopeInput): InboxScope {
  const scoped = mailboxes.map((mailbox) => ({
    id: mailbox.id,
    label: mailbox.label,
    loaded: messages.filter((message) => message.mailbox === mailbox.id).length,
    bounded: atLimit.get(mailbox.id) ?? false,
  }))
  return {
    view,
    pages,
    mailboxes: scoped,
    failed,
    incomplete,
    readable,
    mailboxLimit: mailboxes.length,
    messageLimit: perMailbox * pages,
    loaded: messages.length,
    bounded: scoped.some((mailbox) => mailbox.bounded),
    readAt: format.clock(at),
    refreshedAt: at.toISOString(),
  }
}

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
