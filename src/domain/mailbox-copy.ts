/**
 * A mailbox copy: one provider-visible copy of a message in one mailbox.
 * Providers name a message only within a mailbox, so the same message id in
 * two mailboxes, e.g. one delivery to two aliases, is two copies, not a
 * duplicate. Nothing here guesses which copies share a logical message.
 */

/** Names one mailbox copy to a provider. */
export interface MailboxCopyRef {
  /** The mailbox the message was listed in. */
  mailboxId: string
  /** The provider's message id, as listed in that mailbox. */
  messageId: string
}

/**
 * An opaque id for one mailbox copy, distinct for every mailbox and
 * message id pair. It identifies a row; providers get the ref itself.
 */
export const mailboxCopyId = ({ mailboxId, messageId }: MailboxCopyRef) =>
  JSON.stringify([mailboxId, messageId])
