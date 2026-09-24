/**
 * Read-only access to a mail provider. Application code depends on this
 * port, never on a provider's commands or output format.
 */
import type { z } from 'zod'
import type { emailListingSchema, mailboxSchema, threadSchema } from './email'
import type { MailboxCopyRef } from './mailbox-copy'

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
  /** A page of one Inbox state; the provider does the filtering. */
  page?: number
  filter?: 'is:unread' | 'is:read'
}

/**
 * The mailbox copy whose thread to read: any message id from the thread, as
 * `listRecentEmails` returned it for that mailbox.
 */
export type ReadThreadRequest = MailboxCopyRef

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
