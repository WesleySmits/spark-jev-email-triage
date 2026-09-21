/**
 * A read-only `MailReader` backed by the Spark CLI. Calls run one at a time,
 * because Spark's local IPC connection is unreliable under parallel calls.
 */
import type { MailReader } from '../domain/mail-reader'
import {
  accountsCommand,
  emailsCommand,
  threadCommand,
  validateMailboxId,
  type SparkCommand,
} from './commands'
import { SparkError, type SparkErrorCode } from './errors'
import { localTimeZone } from './local-time'
import { parseAccounts } from './parse-accounts'
import { parseEmailList } from './parse-emails'
import { parseThread } from './parse-thread'
import type { SparkTransport } from './process'

/**
 * One Spark call. Holds no addresses, subjects, bodies, ids, or output, so
 * entries are safe to write to any log.
 */
export interface SparkLogEntry {
  event: 'spark_call'
  command: SparkCommand['name']
  outcome: 'ok' | SparkErrorCode | 'unexpected_error'
  durationMs: number
  /** Parsed accounts, listings, or thread messages. `null` on failure. */
  itemCount: number | null
}

export interface SparkReaderOptions {
  transport: SparkTransport
  /** IANA time zone Spark Desktop prints times in, e.g. `Europe/Amsterdam`. */
  timeZone: string
  log: (entry: SparkLogEntry) => void
}

export function createSparkMailReader({
  transport,
  timeZone,
  log,
}: SparkReaderOptions): MailReader {
  const localTime = localTimeZone(timeZone)
  let queue: Promise<unknown> = Promise.resolve()

  /** Queues one call. `build` runs in the queue, so invalid input rejects. */
  const call = <T>(request: {
    name: SparkCommand['name']
    build: () => SparkCommand
    parse: (stdout: string) => T
    count: (result: T) => number
    signal: AbortSignal | undefined
  }): Promise<T> => {
    const run = async () => {
      const started = performance.now()
      const record = (outcome: SparkLogEntry['outcome'], itemCount: number | null) => {
        log({
          event: 'spark_call',
          command: request.name,
          outcome,
          durationMs: Math.round(performance.now() - started),
          itemCount,
        })
      }
      try {
        const command = request.build()
        if (request.signal?.aborted) throw new SparkError('aborted')
        const result = request.parse(await transport(command, request.signal))
        record('ok', request.count(result))
        return result
      } catch (error) {
        record(error instanceof SparkError ? error.code : 'unexpected_error', null)
        throw error
      }
    }
    const result = queue.then(run)
    queue = result.catch(() => undefined)
    return result
  }

  return {
    listMailboxes: (options) =>
      call({
        name: 'accounts',
        build: accountsCommand,
        parse: parseAccounts,
        count: (mailboxes) => mailboxes.length,
        signal: options?.signal,
      }),

    listRecentEmails: ({ mailboxId, limit }, options) =>
      call({
        name: 'emails',
        build: () => emailsCommand(mailboxId, limit),
        parse: (stdout) => parseEmailList(stdout, { mailboxId, limit, localTime }),
        count: (listings) => listings.length,
        signal: options?.signal,
      }),

    readThread: ({ mailboxId, messageId }, options) =>
      call({
        name: 'thread',
        build: () => {
          validateMailboxId(mailboxId)
          return threadCommand(messageId)
        },
        parse: (stdout) => parseThread(stdout, { mailboxId, messageId, localTime }),
        count: (thread) => thread.messages.length,
        signal: options?.signal,
      }),
  }
}
