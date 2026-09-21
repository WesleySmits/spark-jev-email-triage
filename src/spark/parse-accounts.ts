/**
 * Parses `spark accounts`: a tree with one `Email Account:` root per
 * account. Shared inboxes appear as `Shared Inbox:` entries. Calendars,
 * teams, and aliases are not needed and are skipped.
 */
import { mailboxSchema } from '../domain/email'
import type { MailboxAccess } from '../domain/mail-reader'
import { malformed } from './errors'

const treePrefix = /^[\s│├└─]*/
const entryPattern = /^(Email Account|Shared Inbox): (\S+)(?: .*)? \(Access: ([a-z][a-z-]*)\)/
const readableAccess = new Set(['read-only', 'triage', 'send'])

export function parseAccounts(stdout: string): MailboxAccess[] {
  const mailboxes = new Map<string, MailboxAccess>()
  for (const [index, line] of stdout.split(/\r?\n/).entries()) {
    const entry = line.replace(treePrefix, '')
    if (!entry.startsWith('Email Account:') && !entry.startsWith('Shared Inbox:')) continue
    const mailbox = parseEntry(entry, index)
    if (!mailboxes.has(mailbox.mailbox.id)) mailboxes.set(mailbox.mailbox.id, mailbox)
  }
  if (mailboxes.size === 0 && stdout.trim() !== '') {
    throw malformed('accounts: no account entries')
  }
  return [...mailboxes.values()]
}

function parseEntry(entry: string, index: number): MailboxAccess {
  const match = entryPattern.exec(entry)
  const [, label, address, access] = match ?? []
  const mailbox = mailboxSchema.safeParse({ id: address, address })
  if (!mailbox.success || access === undefined) {
    throw malformed(`accounts: line ${String(index + 1)} is not a mailbox entry`)
  }
  return {
    mailbox: mailbox.data,
    kind: label === 'Shared Inbox' ? 'shared_inbox' : 'account',
    // Unknown levels fail closed. `read-only` and `triage` are documented;
    // Spark 1.3.1 also reports `send`, which lists mail normally.
    canRead: readableAccess.has(access),
  }
}
