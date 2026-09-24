/**
 * Spark 1.3.1's Done action accepts one message id, not a mailbox copy or a
 * conditional thread version. The caller owns approval, receipts and the
 * order of these separate steps. Readback proves only the observed folder
 * state; another copy or a concurrent message can still be affected.
 */
import { execFile } from 'node:child_process'
import type { ActionTarget } from '../domain/mailbox-action'
import { accountsCommand, emailsCommand, sparkArguments, threadCommand } from './commands'
import { malformed, SparkError } from './errors'
import { localTimeZone } from './local-time'
import { parseEmailList } from './parse-emails'
import { parseThread } from './parse-thread'
import { runSparkSerial } from './queue'

const maxReadLimit = 100
const maxReadPages = 20
const numericId = /^[1-9][0-9]{0,18}$/
const pageLine = /^Page ([1-9][0-9]*) of ([1-9][0-9]*)(\+?) \(([0-9]+)(\+?) total emails\)$/
const accountLine =
  /^[\s│├└─]*(?:Email Account|Shared Inbox): (\S+)(?: .*)? \(Access: ([a-z][a-z-]*)\)$/

interface PageInfo {
  pages: number
  total: number
  approximate: boolean
}

function pageInfo(output: string, page: number, limit: number, rowCount: number): PageInfo {
  const matches = output
    .split(/\r?\n/)
    .map((line) => pageLine.exec(line.trim()))
    .filter((match) => match !== null)
  if (
    rowCount === 0 &&
    page === 1 &&
    matches.length === 0 &&
    output.split(/\r?\n/).some((line) => line === 'No emails found.')
  ) {
    return { pages: 1, total: 0, approximate: false }
  }
  const footer = matches[0]
  if (!footer || matches.length !== 1) throw malformed('emails: missing or repeated page footer')
  return validatePageFooter(footer, page, limit, rowCount)
}

function validatePageFooter(
  footer: RegExpExecArray,
  page: number,
  limit: number,
  rowCount: number,
): PageInfo {
  const current = Number(footer[1])
  const pages = Number(footer[2])
  const total = Number(footer[4])
  const approximate = footer[3] === '+' && footer[5] === '+'
  const exact = footer[3] === '' && footer[5] === ''
  if (current !== page || !Number.isSafeInteger(total) || (!approximate && !exact)) {
    throw malformed('emails: inconsistent pagination')
  }
  assertPageCount(pages, total, limit, exact)
  const expectedRows = approximate ? limit : Math.min(limit, total - (page - 1) * limit)
  if (rowCount !== expectedRows) throw malformed('emails: inconsistent pagination')
  return { pages, total, approximate }
}

function assertPageCount(pages: number, total: number, limit: number, exact: boolean): void {
  if (pages !== Math.ceil(total / limit) || (exact && pages > maxReadPages)) {
    throw malformed('emails: inconsistent pagination')
  }
}

function assertStablePage(expected: PageInfo | undefined, actual: PageInfo): void {
  if (!expected) return
  if (
    actual.pages !== expected.pages ||
    actual.total !== expected.total ||
    actual.approximate !== expected.approximate
  ) {
    throw malformed('emails: pagination changed')
  }
}

function addUniqueIds(seen: Set<string>, items: readonly { messageId: string }[]): void {
  for (const item of items) {
    if (seen.has(item.messageId)) throw malformed('emails: repeated message')
    seen.add(item.messageId)
  }
}

/** A shell-free transport. Tests inject a fake and cannot reach a mailbox. */
export type SparkDoneCliTransport = (
  args: readonly string[],
  signal?: AbortSignal,
) => Promise<string>

/**
 * Run one validated argument vector. stdout/stderr and raw process errors are
 * never put into thrown errors or logs. No retry is performed here.
 */
export function createSparkDoneProcessTransport(): SparkDoneCliTransport {
  return (args, signal) =>
    runSparkSerial(
      () =>
        new Promise((resolve, reject) => {
          if (signal?.aborted) {
            reject(new SparkError('aborted'))
            return
          }
          execFile(
            'spark',
            [...args],
            {
              shell: false,
              timeout: 15_000,
              maxBuffer: 4 * 1024 * 1024,
              windowsHide: true,
              signal,
            },
            (error, stdout) => {
              if (error) {
                const code = 'code' in error ? error.code : null
                reject(
                  new SparkError(
                    code === 'ENOENT'
                      ? 'not_installed'
                      : code === 'ABORT_ERR'
                        ? 'aborted'
                        : code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'
                          ? 'output_too_large'
                          : 'exit_failure',
                  ),
                )
                return
              }
              resolve(stdout)
            },
          )
        }),
    )
}

export interface SparkDoneProviderPort {
  preflight(target: ActionTarget, signal?: AbortSignal): Promise<'ready' | 'refused'>
  /** Exactly one CLI mutation, with one numeric id and no mailbox argument. */
  markAsDone(messageId: string, signal?: AbortSignal): Promise<void>
  readback(target: ActionTarget, signal?: AbortSignal): Promise<'confirmed' | 'uncertain'>
}

export function createSparkDoneProvider({
  transport,
  timeZone,
  limit = maxReadLimit,
}: {
  transport: SparkDoneCliTransport
  timeZone: string
  limit?: number
}): SparkDoneProviderPort {
  const localTime = localTimeZone(timeZone)
  emailsCommand('example@example.com', limit)

  const list = async (
    mailboxId: string,
    folder: 'Inbox' | 'Archive',
    page: number,
    signal?: AbortSignal,
  ) => {
    const args = sparkArguments(emailsCommand(mailboxId, limit, page))
    const folderArgs = folder === 'Inbox' ? args : [...args.slice(0, -1), `${mailboxId}:Archive`]
    const output = await transport(folderArgs, signal)
    const heading = `Emails in ${mailboxId}:${folder}`
    if (!output.split(/\r?\n/).some((line) => line === heading)) {
      throw malformed('emails: unexpected folder')
    }
    const items = parseEmailList(output, { mailboxId, limit, localTime })
    return { items, ...pageInfo(output, page, limit, items.length) }
  }

  const findInFolder = async (
    mailboxId: string,
    folder: 'Inbox' | 'Archive',
    messageId: string,
    signal?: AbortSignal,
  ) => {
    let expected: PageInfo | undefined
    const seen = new Set<string>()
    for (let page = 1; page <= maxReadPages; page += 1) {
      const result = await list(mailboxId, folder, page, signal)
      assertStablePage(expected, result)
      expected ??= result
      addUniqueIds(seen, result.items)
      if (seen.has(messageId)) return true
      if (!result.approximate && page === result.pages) return false
    }
    throw malformed('emails: pagination exceeded bound')
  }

  return {
    async preflight(target, signal) {
      validateTarget(target)
      const { mailboxId, messageId } = target.copy
      try {
        const accounts = await transport(sparkArguments(accountsCommand()), signal)
        if (!hasTriageAccess(accounts, mailboxId)) {
          return 'refused'
        }
        const inbox = await list(mailboxId, 'Inbox', 1, signal)
        if (inbox.items.filter((item) => item.messageId === messageId).length !== 1) {
          return 'refused'
        }
        const output = await transport(sparkArguments(threadCommand(messageId)), signal)
        const thread = parseThread(output, { mailboxId, messageId, localTime })
        if (
          thread.id !== target.threadId ||
          thread.messages.at(-1)?.id !== target.latestMessageId
        ) {
          return 'refused'
        }
        return 'ready'
      } catch {
        return 'refused'
      }
    },

    async markAsDone(messageId, signal) {
      validateMessageId(messageId)
      try {
        await transport(['action', 'markAsDone', messageId], signal)
      } catch {
        // An error or timeout may follow a committed provider write. The
        // caller must still read back and must not retry this attempt.
        throw new SparkError('exit_failure')
      }
    },

    async readback(target, signal) {
      validateTarget(target)
      const { mailboxId, messageId } = target.copy
      try {
        const archiveHasTarget = await findInFolder(mailboxId, 'Archive', messageId, signal)
        if (!archiveHasTarget) {
          return 'uncertain'
        }
        if (await findInFolder(mailboxId, 'Inbox', messageId, signal)) {
          return 'uncertain'
        }
        return 'confirmed'
      } catch {
        return 'uncertain'
      }
    },
  }
}

function validateMessageId(messageId: string): void {
  if (!numericId.test(messageId)) throw new SparkError('invalid_input', 'messageId')
}

function validateTarget(target: ActionTarget): void {
  // The command builders validate the provider address and selected id before
  // any subprocess is reached. The version ids are equally untrusted input.
  emailsCommand(target.copy.mailboxId, 1)
  threadCommand(target.copy.messageId)
  validateMessageId(target.threadId)
  validateMessageId(target.latestMessageId)
}

function hasTriageAccess(output: string, mailboxId: string): boolean {
  const matches = output
    .split(/\r?\n/)
    .map((line) => accountLine.exec(line))
    .filter((match) => match?.[1]?.toLowerCase() === mailboxId.toLowerCase())
  return matches.length === 1 && matches[0]?.[2] === 'triage'
}
