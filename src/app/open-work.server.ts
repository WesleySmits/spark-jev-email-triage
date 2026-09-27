import { existsSync } from 'node:fs'
import { userInfo } from 'node:os'
import type { MailReader, MailboxAccess } from '../domain/mail-reader'
import type { ActionTarget, TargetObservation } from '../domain/mailbox-action'
import { mailboxCopyId, type MailboxCopyRef } from '../domain/mailbox-copy'
import { decideFollowUp } from '../domain/follow-up'
import {
  openWorkList,
  openWorkTally,
  type InboxEvidence,
  type InboxPlace,
  type DecidedCopyCursor,
} from '../domain/open-work'
import { readDatabasePath } from '../shadow/config'
import { openForWriting, openReadOnly } from '../shadow/database'
import {
  readDecidedCopies,
  readFollowUpRequest,
  readFollowUps,
  recordFollowUp,
} from '../shadow/follow-ups'
import type {
  OpenWorkRead,
  WorkDecisionRequest,
  WorkDecisionResult,
  WorkMessageRead,
  WorkMessageRequest,
} from './open-work'

type Env = Readonly<Record<string, string | undefined>>
type Verified = Readonly<{ evidence: InboxEvidence; observation?: TargetObservation }>

/** A bounded scan never treats a missing copy as proof of removal. */
const pageLimit = 10
const pageSize = 25

type ViewScan = Readonly<{ ids: ReadonlySet<string>; complete: boolean }>
type MailboxScan =
  | Readonly<{ status: 'ready'; views: ReadonlyMap<string, InboxPlace>; complete: boolean }>
  | Readonly<{ status: 'absent' | 'unreadable' }>

async function scanView(
  reader: MailReader,
  mailboxId: string,
  view: InboxPlace,
): Promise<ViewScan> {
  const filter = view === 'unread' ? 'is:unread' : 'is:read'
  const ids = new Set<string>()
  for (let page = 1; page <= pageLimit; page++) {
    const rows = await reader.listRecentEmails({
      mailboxId,
      limit: pageSize,
      page,
      filter,
    })
    for (const row of rows) ids.add(row.messageId)
    if (rows.length < pageSize) return { ids, complete: true }
  }
  return { ids, complete: false }
}

async function scanMailbox(
  reader: MailReader,
  mailboxId: string,
  access: readonly MailboxAccess[] | null,
): Promise<MailboxScan> {
  if (!access) return { status: 'unreadable' }
  if (!access.some(({ mailbox, canRead }) => mailbox.id === mailboxId && canRead))
    return { status: 'absent' }
  try {
    const unread = await scanView(reader, mailboxId, 'unread')
    const read = await scanView(reader, mailboxId, 'read')
    const views = new Map<string, InboxPlace>()
    for (const id of unread.ids) views.set(id, 'unread')
    for (const id of read.ids) views.set(id, 'read')
    return { status: 'ready', views, complete: unread.complete && read.complete }
  } catch {
    return { status: 'unreadable' }
  }
}

function evidenceFor(scan: MailboxScan, copy: MailboxCopyRef): InboxEvidence {
  if (scan.status !== 'ready') return { reach: scan.status }
  const view = scan.views.get(copy.messageId)
  if (view) return { reach: 'listed', view }
  return { reach: scan.complete ? 'read_completely' : 'bounded' }
}

async function observeVersion(
  reader: MailReader,
  copy: MailboxCopyRef,
): Promise<TargetObservation | undefined> {
  try {
    const thread = await reader.readThread(copy)
    const latest = thread.messages.at(-1)
    if (!latest) return undefined
    return {
      copy,
      observed: 'named',
      threadId: thread.id,
      latestMessageId: latest.id,
      proven: true,
    }
  } catch {
    return undefined
  }
}

export async function inspectCopy(reader: MailReader, copy: MailboxCopyRef): Promise<Verified> {
  try {
    const access = await reader.listMailboxes()
    const scan = await scanMailbox(reader, copy.mailboxId, access)
    const evidence = evidenceFor(scan, copy)
    if (scan.status !== 'ready') return { evidence }
    const observation = await observeVersion(reader, copy)
    return observation ? { evidence, observation } : { evidence }
  } catch {
    return { evidence: { reach: 'unreadable' } }
  }
}

const actor = () => {
  try {
    return userInfo().username.trim() || 'local'
  } catch {
    return 'local'
  }
}

/** Reads only local decisions and bounded Spark evidence; no mailbox command is issued. */
export async function readOpenWork(
  reader: MailReader,
  env: Env = process.env,
  now: () => Date = () => new Date(),
  cursor: DecidedCopyCursor | null = null,
): Promise<OpenWorkRead> {
  const path = readDatabasePath(env)
  if (!existsSync(path)) {
    return {
      status: 'ready',
      items: [],
      tally: openWorkTally([]),
      nextCursor: null,
      checkedAt: now().toISOString(),
    }
  }
  try {
    const db = openReadOnly(path)
    let recorded: ReturnType<typeof readDecidedCopies>
    try {
      recorded = readDecidedCopies(db, cursor)
    } finally {
      db.close()
    }
    const access = await reader.listMailboxes().catch(() => null)
    const scans = new Map<string, MailboxScan>()
    const records = []
    for (const entry of recorded.copies) {
      let scan = scans.get(entry.copy.mailboxId)
      if (!scan) {
        scan = await scanMailbox(reader, entry.copy.mailboxId, access)
        scans.set(entry.copy.mailboxId, scan)
      }
      const evidence = evidenceFor(scan, entry.copy)
      const observation =
        scan.status === 'ready' ? await observeVersion(reader, entry.copy) : undefined
      records.push({ ...entry, evidence, ...(observation && { observation }) })
    }
    const checkedAt = now().toISOString()
    const items = openWorkList(records, checkedAt)
    return {
      status: 'ready',
      items,
      tally: openWorkTally(items),
      nextCursor: recorded.nextCursor,
      checkedAt,
    }
  } catch {
    return { status: 'unavailable' }
  }
}

/** Reads the selected recorded copy on demand; body text is never stored. */
export async function readWorkMessage(
  reader: MailReader,
  request: WorkMessageRequest,
  env: Env = process.env,
): Promise<WorkMessageRead> {
  const path = readDatabasePath(env)
  if (!existsSync(path)) return { status: 'unavailable' }
  try {
    const db = openReadOnly(path)
    try {
      if (!readFollowUps(db, [request.copy]).has(mailboxCopyId(request.copy)))
        return { status: 'unavailable' }
    } finally {
      db.close()
    }
    const access = await reader.listMailboxes()
    if (!access.some(({ mailbox, canRead }) => mailbox.id === request.copy.mailboxId && canRead))
      return { status: 'unavailable' }
    const thread = await reader.readThread(request.copy)
    if (
      thread.mailboxId !== request.copy.mailboxId ||
      !thread.messages.some(({ id }) => id === request.copy.messageId)
    )
      return { status: 'unavailable' }
    const latest = thread.messages.at(-1)
    if (!latest) return { status: 'unavailable' }
    return {
      status: 'ready',
      target: { copy: request.copy, threadId: thread.id, latestMessageId: latest.id },
      subject: thread.subject,
      messages: thread.messages.map((message) => ({
        id: message.id,
        sender: message.from.name ?? message.from.address,
        sentAt: message.sentAt,
        text: message.bodyText,
      })),
    }
  } catch {
    return { status: 'unavailable' }
  }
}

/** Rechecks the exact copy and version before appending a local decision. */
export async function saveWorkDecision(
  reader: MailReader,
  request: WorkDecisionRequest,
  env: Env = process.env,
  now: () => Date = () => new Date(),
): Promise<WorkDecisionResult> {
  const path = readDatabasePath(env)
  if (!existsSync(path)) return { status: 'unavailable' }
  const decision = decideFollowUp({
    target: request.target,
    kind: request.kind,
    dueAt: request.dueAt,
    decidedBy: actor(),
    decidedAt: now().toISOString(),
  })
  try {
    const db = openReadOnly(path)
    try {
      const previous = readFollowUpRequest(db, { decision, requestId: request.requestId })
      if (previous.status === 'recorded') return { status: 'recorded' }
      if (previous.status === 'refused') return previous
    } finally {
      db.close()
    }
  } catch {
    return { status: 'unavailable' }
  }
  const { evidence, observation } = await inspectCopy(reader, request.target.copy)
  const mayBeOutsideInbox = request.kind === 'reopen' || request.kind === 'handled_in_spark'
  if ((!mayBeOutsideInbox && evidence.reach !== 'listed') || observation?.observed !== 'named') {
    return { status: 'refused', reason: 'unverified' }
  }
  const target: ActionTarget = request.target
  if (
    mailboxCopyId(observation.copy) !== mailboxCopyId(target.copy) ||
    observation.threadId !== target.threadId ||
    observation.latestMessageId !== target.latestMessageId
  ) {
    return { status: 'refused', reason: 'stale' }
  }
  try {
    const db = openForWriting(path)
    try {
      const result = recordFollowUp(db, decision, request.requestId)
      return result
    } finally {
      db.close()
    }
  } catch {
    return { status: 'unknown' }
  }
}
