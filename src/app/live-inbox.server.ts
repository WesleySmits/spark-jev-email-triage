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
import { randomUUID } from 'node:crypto'
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
  InboxDiscovery,
  InboxDiscoveryRequest,
  InboxDiscoveryScope,
  InboxListRequest,
  InboxRefresh,
  InboxRefreshRequest,
  InboxRefreshSummary,
  InboxScope,
  InboxView,
  LiveInbox,
  MailboxFailure,
  MailboxRefresh,
} from './live-inbox'

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

type PageListing = Readonly<{ listing: Listing; page: number }>
interface MailboxProgress {
  listings: PageListing[]
  nextPage: number
  bounded: boolean
  failed?: MailboxFailure['reason'] | undefined
  incomplete?: MailboxFailure['reason'] | undefined
}
interface ReadingProgress {
  cursor: string
  view: InboxListRequest['view']
  pages: number
  readable: number
  mailboxes: ShownMailbox[]
  progress: Map<string, MailboxProgress>
  lastReadAt?: Date | undefined
}

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
  let reading: ReadingProgress | undefined
  let discovery: (ReadingProgress & { query: string }) | undefined
  /** Serializes cursor claims before any discovery provider I/O begins. */
  let searches: Promise<void> = Promise.resolve()
  /** Counts list reads, so only the latest one decides what is offered. */
  let reads = 0

  const list = async (
    options?: ReadOptions,
    request: InboxListRequest = { view: 'unread' },
  ): Promise<LiveInbox> => {
    // Nothing is offered while a list reads, and a list that fails offers
    // nothing, so an older list's bodies stay closed.
    const read = ++reads
    offered = new Set()
    discovery = undefined
    try {
      const selected = await selectReading(reader, reading, request, options)
      const { current } = selected
      // A stale/replayed cursor returns the current honest snapshot. It never
      // skips pages or turns one request into an unbounded provider loop.
      if (selected.advance) await advanceReading(reader, current, options)
      current.pages = Math.max(
        1,
        ...[...current.progress.values()].map((progress) => progress.nextPage - 1),
      )
      const at = now()
      current.cursor = randomUUID()
      current.lastReadAt = at
      reading = current
      const listed = listedFrom(current)
      const messages = summariesOf(unique(listed), current.view, at, format)
      if (read === reads) offered = new Set(messages.map((message) => message.id))
      const scope = readingScope(current, messages, at, format)
      return { status: 'ready', scope, mailboxes: current.mailboxes, messages }
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
      if (!offered.has(copyId)) {
        if (selection) {
          if (await selectedPageOffers(reader, ref, selection, options)) offered.add(copyId)
        } else {
          await list(options)
        }
      }
      if (!offered.has(copyId)) throw new BodyUnavailableError()
      return bodyOf(await reader.readThread(ref, options), ref, verify)
    } catch {
      throw new BodyUnavailableError()
    }
  }

  /**
   * Searches the sender and subject metadata Spark lists. A new query searches
   * every page already loaded for its view; a matching cursor advances at
   * most one provider page per still-bounded mailbox. Search text never goes
   * to Spark or the reader log, and no thread/body is read.
   */
  const runSearch = async (
    request: InboxDiscoveryRequest,
    options?: ReadOptions,
  ): Promise<InboxDiscovery> => {
    const read = ++reads
    offered = new Set()
    try {
      const selected = await selectDiscovery(reader, reading, discovery, request, options)
      const { current, advance } = selected
      if (advance) await advanceReading(reader, current, options)
      current.pages = completedPages(current)
      const at = now()
      current.cursor = randomUUID()
      // Page shifts can repeat a copy at a later offset. Scope and results
      // count the copy once, while page depth still says what was requested.
      const listed = unique(listedFrom(current))
      const matches = listed.filter(({ listing }) => matchesQuery(listing, request.query))
      const messages = summariesOf(unique(matches), current.view, at, format)
      if (read === reads) {
        discovery = current
        // Pages found while searching become part of the loaded reading too,
        // so the next discovery begins at the reached depth. Keep a list's
        // cursor valid, and never replace a reading of another view.
        if (reading === undefined || reading.view === current.view) {
          reading = { ...cloneReading(current), cursor: reading?.cursor ?? current.cursor }
        }
        offered = new Set(messages.map((message) => message.id))
      }
      return {
        status: 'ready',
        scope: discoveryScopeOf(current, listed, messages, at, format),
        mailboxes: current.mailboxes,
        messages,
      }
    } catch (error) {
      return { status: 'unavailable', reason: reasonFor(error) }
    }
  }

  const search = (request: InboxDiscoveryRequest, options?: ReadOptions) => {
    const result = searches.then(() => runSearch(request, options))
    searches = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }

  /** Re-reads the current view's loaded page depth, never beyond it. */
  const refresh = async (
    request: InboxRefreshRequest,
    options?: ReadOptions,
  ): Promise<InboxRefresh> => {
    const read = ++reads
    offered = new Set()
    discovery = undefined
    try {
      const before = reading?.view === request.view ? cloneReading(reading) : undefined
      const current = await refreshReading(reader, request.view, before, options)
      current.pages = completedPages(current)
      const at = now()
      current.cursor = randomUUID()
      current.lastReadAt = at
      const listed = unique(listedFrom(current))
      const messages = summariesOf(listed, current.view, at, format)
      const scope = readingScope(current, messages, at, format)
      if (read === reads) {
        reading = current
        offered = new Set(messages.map((message) => message.id))
      }
      return {
        status: 'ready',
        scope,
        mailboxes: current.mailboxes,
        messages,
        refresh: refreshSummary(before, current, at, format),
      }
    } catch (error) {
      return { status: 'unavailable', reason: reasonFor(error) }
    }
  }

  return { list, search, refresh, body } as const
}

type DiscoveryProgress = ReadingProgress & { query: string }

async function selectDiscovery(
  reader: MailReader,
  reading: ReadingProgress | undefined,
  discovery: DiscoveryProgress | undefined,
  request: InboxDiscoveryRequest,
  options?: ReadOptions,
): Promise<{ current: DiscoveryProgress; advance: boolean }> {
  const active =
    discovery?.view === request.view && discovery.query === request.query ? discovery : undefined
  if (request.cursor !== undefined && active !== undefined) {
    return {
      current: { ...cloneReading(active), query: active.query },
      advance: active.cursor === request.cursor,
    }
  }
  if (reading?.view === request.view) {
    return { current: { ...cloneReading(reading), query: request.query }, advance: false }
  }
  return {
    current: { ...(await startReading(reader, request.view, options)), query: request.query },
    // A query without a same-view reading only establishes its empty scope.
    // Its returned cursor must be presented before page 1 is fetched.
    advance: false,
  }
}

const completedPages = (reading: ReadingProgress) =>
  Math.max(1, ...[...reading.progress.values()].map((progress) => progress.nextPage - 1))

const pagesToRefresh = (previous: MailboxProgress | undefined) =>
  Math.max(1, (previous?.nextPage ?? 2) - 1 + (previous?.incomplete ? 1 : 0))

async function refreshMailbox(
  reader: MailReader,
  view: InboxView,
  mailbox: ReadingProgress['mailboxes'][number],
  progress: MailboxProgress,
  pages: number,
  options?: ReadOptions,
) {
  for (let page = 0; page < pages && progress.bounded && !progress.failed; page += 1) {
    await advanceMailbox(reader, view, mailbox.id, progress, options)
  }
}

async function refreshReading(
  reader: MailReader,
  view: InboxView,
  before: ReadingProgress | undefined,
  options?: ReadOptions,
) {
  const current = await startReading(reader, view, options)
  for (const mailbox of current.mailboxes) {
    const progress = current.progress.get(mailbox.id)
    if (!progress) continue
    const previous = before?.progress.get(mailbox.id)
    // A failed later page belongs to the attempted window even though it was
    // not retained. Refresh retries that page, but never advances beyond it.
    await refreshMailbox(reader, view, mailbox, progress, pagesToRefresh(previous), options)
  }
  return current
}

const listedId = ({ listing, mailbox }: Listed) =>
  mailboxCopyId({ mailboxId: mailbox.id, messageId: listing.messageId })

const listedTime = ({ listing }: Listed) =>
  listing.date === null ? Number.MIN_SAFE_INTEGER : Date.parse(listing.date)

function changesBetween(before: readonly Listed[], after: readonly Listed[], bounded: boolean) {
  const previous = new Map(before.map((row) => [listedId(row), row.listing]))
  const current = new Map(after.map((row) => [listedId(row), row.listing]))
  const oldestRefreshed = Math.min(...after.map(listedTime))
  const added = [...current.keys()].filter((id) => !previous.has(id)).length
  const removed = before.filter(
    (row) => !current.has(listedId(row)) && !(bounded && listedTime(row) <= oldestRefreshed),
  ).length
  const updated = [...current].filter(([id, listing]) => {
    const old = previous.get(id)
    return old !== undefined && JSON.stringify(old) !== JSON.stringify(listing)
  }).length
  return { added, removed, updated } as const
}

const noKnownChanges = { added: 0, removed: 0, updated: 0 } as const

function refreshStatus(progress: MailboxProgress | undefined): MailboxRefresh['status'] {
  if (progress?.failed) return 'failed'
  if (progress?.incomplete) return 'incomplete'
  return 'refreshed'
}

function knownMailboxChanges(
  id: string,
  reason: MailboxFailure['reason'] | undefined,
  previous: readonly Listed[] | undefined,
  refreshed: readonly Listed[],
  bounded: boolean,
) {
  // A partial or failed read cannot prove that an absent row left the
  // mailbox. Only a completely refreshed window contributes change counts.
  if (reason || previous === undefined) return noKnownChanges
  return changesBetween(
    previous.filter((row) => row.mailbox.id === id),
    refreshed.filter((row) => row.mailbox.id === id),
    bounded,
  )
}

const refreshedPageDepth = (progress: MailboxProgress | undefined) =>
  Math.max(0, (progress?.nextPage ?? 1) - 1)

function successfulReadTime(
  progress: MailboxProgress | undefined,
  at: Date,
  format: ReturnType<typeof timeFormats>,
) {
  if (progress?.failed) return {}
  return { readAt: format.clock(at), refreshedAt: at.toISOString() }
}

function mailboxRefresh(
  mailbox: ShownMailbox,
  progress: MailboxProgress | undefined,
  previous: readonly Listed[] | undefined,
  refreshed: readonly Listed[],
  at: Date,
  format: ReturnType<typeof timeFormats>,
): MailboxRefresh {
  const reason = progress?.failed ?? progress?.incomplete
  return {
    id: mailbox.id,
    label: mailbox.label,
    pages: refreshedPageDepth(progress),
    ...knownMailboxChanges(mailbox.id, reason, previous, refreshed, progress?.bounded ?? false),
    status: refreshStatus(progress),
    ...(reason && { reason }),
    ...successfulReadTime(progress, at, format),
  }
}

function refreshSummary(
  before: ReadingProgress | undefined,
  current: ReadingProgress,
  at: Date,
  format: ReturnType<typeof timeFormats>,
): InboxRefreshSummary {
  const previous = before ? unique(listedFrom(before)) : undefined
  const refreshed = unique(listedFrom(current))
  const mailboxes = current.mailboxes.map((mailbox) =>
    mailboxRefresh(mailbox, current.progress.get(mailbox.id), previous, refreshed, at, format),
  )
  const changes = mailboxes.reduce(
    (total, mailbox) => ({
      added: total.added + mailbox.added,
      removed: total.removed + mailbox.removed,
      updated: total.updated + mailbox.updated,
    }),
    { added: 0, removed: 0, updated: 0 },
  )
  return {
    mailboxes,
    ...changes,
    ...(before?.lastReadAt && { previousReadAt: before.lastReadAt.toISOString() }),
    readAt: format.clock(at),
    refreshedAt: at.toISOString(),
  }
}

function matchesQuery(listing: Listing, query: string) {
  const needle = query.trim().toLowerCase()
  return [listing.sender?.text, listing.subject?.text].some((value) =>
    value?.toLowerCase().includes(needle),
  )
}

function summariesOf(
  listed: readonly Listed[],
  view: InboxView,
  at: Date,
  format: ReturnType<typeof timeFormats>,
) {
  return newestFirst(listed).map(({ listing, mailbox, page }) =>
    summarize(listing, mailbox, page, view, format.listed(listing.date, at)),
  )
}

function discoveryScopeOf(
  reading: ReadingProgress & { query: string },
  listed: readonly Listed[],
  messages: readonly InboxSummary[],
  at: Date,
  format: ReturnType<typeof timeFormats>,
): InboxDiscoveryScope {
  const mailboxes = reading.mailboxes.map((mailbox) => {
    const progress = reading.progress.get(mailbox.id)
    const scanned = listed.filter((row) => row.mailbox.id === mailbox.id).length
    const matched = messages.filter((row) => row.mailbox === mailbox.id).length
    return {
      id: mailbox.id,
      label: mailbox.label,
      pages: Math.max(0, (progress?.nextPage ?? 1) - 1),
      scanned,
      matched,
      bounded: progress?.bounded ?? false,
    }
  })
  return {
    view: reading.view,
    query: reading.query,
    fields: ['sender', 'subject'],
    valuesMayBeTruncated: true,
    pageSize: perMailbox,
    cursor: reading.cursor,
    mailboxes,
    failed: failuresOf(reading, 'failed'),
    incomplete: failuresOf(reading, 'incomplete'),
    readable: reading.readable,
    scanned: listed.length,
    matched: messages.length,
    bounded: mailboxes.some((mailbox) => mailbox.bounded),
    searchedAt: format.clock(at),
    searchCompletedAt: at.toISOString(),
  }
}

async function selectReading(
  reader: MailReader,
  reading: ReadingProgress | undefined,
  request: InboxListRequest,
  options?: ReadOptions,
) {
  const active = reading?.view === request.view ? reading : undefined
  if (request.cursor === undefined || active === undefined) {
    return { current: await startReading(reader, request.view, options), advance: true } as const
  }
  return { current: cloneReading(active), advance: active.cursor === request.cursor } as const
}

async function selectedPageOffers(
  reader: MailReader,
  ref: MailboxCopyRef,
  selection: NonNullable<BodyRequest['selection']>,
  options?: ReadOptions,
) {
  const readable = (await reader.listMailboxes(options)).some(
    (access) => access.canRead && access.mailbox.id === ref.mailboxId,
  )
  if (!readable) return false
  const rows = await reader.listRecentEmails(
    {
      mailboxId: ref.mailboxId,
      limit: perMailbox,
      page: selection.page,
      filter: selection.view === 'unread' ? 'is:unread' : 'is:read',
    },
    options,
  )
  return rows.some((row) => row.messageId === ref.messageId)
}

async function startReading(
  reader: MailReader,
  view: InboxListRequest['view'],
  options?: ReadOptions,
): Promise<ReadingProgress> {
  const readable = (await reader.listMailboxes(options)).filter((access) => access.canRead)
  const mailboxes = readable.map(({ mailbox }, index) => ({
    id: mailbox.id,
    account: markerAt(index),
    label: mailbox.address,
  }))
  return {
    cursor: randomUUID(),
    view,
    pages: 1,
    readable: readable.length,
    mailboxes,
    progress: new Map(
      mailboxes.map((mailbox) => [
        mailbox.id,
        { listings: [], nextPage: 1, bounded: true } satisfies MailboxProgress,
      ]),
    ),
  }
}

const cloneReading = (reading: ReadingProgress): ReadingProgress => ({
  ...reading,
  progress: new Map(
    [...reading.progress].map(([id, progress]) => [
      id,
      { ...progress, listings: [...progress.listings] },
    ]),
  ),
})

/** Read at most one next page per mailbox and retain every completed page. */
async function advanceReading(reader: MailReader, reading: ReadingProgress, options?: ReadOptions) {
  for (const mailbox of reading.mailboxes) {
    const progress = reading.progress.get(mailbox.id)
    if (progress) await advanceMailbox(reader, reading.view, mailbox.id, progress, options)
  }
}

async function advanceMailbox(
  reader: MailReader,
  view: InboxListRequest['view'],
  mailboxId: string,
  progress: MailboxProgress,
  options?: ReadOptions,
) {
  if (!progress.bounded || progress.failed) return
  const page = progress.nextPage
  try {
    const rows = await reader.listRecentEmails(
      {
        mailboxId,
        limit: perMailbox,
        page,
        filter: view === 'unread' ? 'is:unread' : 'is:read',
      },
      options,
    )
    progress.listings.push(...rows.map((listing) => ({ listing, page })))
    progress.nextPage = page + 1
    progress.bounded = rows.length >= perMailbox
    progress.incomplete = undefined
  } catch (error) {
    if (options?.signal?.aborted) throw error
    recordPageFailure(progress, page, reasonFor(error))
  }
}

function recordPageFailure(
  progress: MailboxProgress,
  page: number,
  reason: MailboxFailure['reason'],
) {
  if (page === 1) {
    progress.failed = reason
    progress.bounded = false
    return
  }
  progress.incomplete = reason
  progress.bounded = true
}

const listedFrom = (reading: ReadingProgress): Listed[] =>
  reading.mailboxes.flatMap((mailbox) =>
    (reading.progress.get(mailbox.id)?.listings ?? []).map(({ listing, page }) => ({
      listing,
      mailbox,
      page,
    })),
  )

function failuresOf(reading: ReadingProgress, kind: 'failed' | 'incomplete') {
  return reading.mailboxes.flatMap((mailbox): MailboxFailure[] => {
    const reason = reading.progress.get(mailbox.id)?.[kind]
    return reason ? [{ id: mailbox.id, label: mailbox.label, reason }] : []
  })
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

function readingScope(
  current: ReadingProgress,
  messages: readonly InboxSummary[],
  at: Date,
  format: ReturnType<typeof timeFormats>,
) {
  return scopeOf({
    mailboxes: current.mailboxes,
    messages,
    readable: current.readable,
    view: current.view,
    pages: current.pages,
    cursor: current.cursor,
    atLimit: new Map(
      current.mailboxes.map((mailbox) => [
        mailbox.id,
        current.progress.get(mailbox.id)?.bounded ?? false,
      ]),
    ),
    pageDepth: new Map(
      current.mailboxes.map((mailbox) => [
        mailbox.id,
        Math.max(0, (current.progress.get(mailbox.id)?.nextPage ?? 1) - 1),
      ]),
    ),
    failed: failuresOf(current, 'failed'),
    incomplete: failuresOf(current, 'incomplete'),
    at,
    format,
  })
}

type ScopeInput = Readonly<{
  mailboxes: readonly ShownMailbox[]
  messages: readonly InboxSummary[]
  /** Readable mailboxes the provider offered, before the mailbox bound. */
  readable: number
  view: InboxListRequest['view']
  pages: number
  cursor: string
  /** Per mailbox: whether its listing came back at the per-mailbox bound. */
  atLimit: ReadonlyMap<string, boolean>
  /** Completed pages retained per mailbox. */
  pageDepth: ReadonlyMap<string, number>
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
  cursor,
  atLimit,
  pageDepth,
  failed,
  incomplete,
  at,
  format,
}: ScopeInput): InboxScope {
  const scoped = mailboxes.map((mailbox) => ({
    id: mailbox.id,
    label: mailbox.label,
    loaded: messages.filter((message) => message.mailbox === mailbox.id).length,
    pages: pageDepth.get(mailbox.id) ?? 0,
    bounded: atLimit.get(mailbox.id) ?? false,
  }))
  return {
    view,
    pages,
    cursor,
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
type Listed = Readonly<{ listing: Listing; mailbox: ShownMailbox; page: number }>

/** Listed text as the row shows it: a cut value ends in `…`, a missing one is `null`. */
const shown = (value: Listing['subject']) => value && (value.cut ? `${value.text}…` : value.text)

/** One strict queue row for a listing. Lists can cut values, so some end in `…`. */
function summarize(
  listing: Listing,
  mailbox: ShownMailbox,
  page: number,
  view: InboxListRequest['view'],
  time: Pick<InboxSummary, 'time' | 'dateTime'>,
): InboxSummary {
  return inboxSummarySchema.parse({
    id: mailboxCopyId({ mailboxId: mailbox.id, messageId: listing.messageId }),
    messageId: listing.messageId,
    sourcePage: page,
    workflow: 'inbox',
    mailbox: mailbox.id,
    sender: shown(listing.sender) ?? 'Sender unavailable',
    ...(listing.from && { address: listing.from.address }),
    ...time,
    subject: shown(listing.subject) ?? 'Subject unavailable',
    snippet: '',
    account: { marker: mailbox.account, label: mailbox.label },
    status,
    unread: view === 'unread',
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
