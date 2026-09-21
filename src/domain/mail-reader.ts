/**
 * Read-only access to a mail provider. Application code depends on this
 * port, never on a provider's commands or output format.
 */
import type { z } from 'zod'
import type { emailListingSchema, mailboxSchema, threadSchema } from './email'

export interface MailboxAccess {
  mailbox: z.infer<typeof mailboxSchema>
  kind: 'account' | 'shared_inbox'
  /** Whether the provider currently allows reading this mailbox. */
  canRead: boolean
}

export interface ListRecentEmailsRequest {
  mailboxId: string
  /** Number of messages to list, from 1 up to the provider's maximum. */
  limit: number
}

export interface ReadThreadRequest {
  /** The mailbox the message was listed in. */
  mailboxId: string
  /** Any message id from the thread, as returned by `listRecentEmails`. */
  messageId: string
}

export interface ReadOptions {
  signal?: AbortSignal
}

export interface MailReader {
  listMailboxes(options?: ReadOptions): Promise<MailboxAccess[]>
  listRecentEmails(
    request: ListRecentEmailsRequest,
    options?: ReadOptions,
  ): Promise<z.infer<typeof emailListingSchema>[]>
  readThread(
    request: ReadThreadRequest,
    options?: ReadOptions,
  ): Promise<z.infer<typeof threadSchema>>
}
