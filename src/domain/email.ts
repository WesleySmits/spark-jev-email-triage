/**
 * Email content as the triage domain sees it, independent of any mail
 * provider. Adapters parse provider data through these schemas before it
 * reaches triage, persistence, or UI code.
 *
 * Invariants:
 * - Unknown or unavailable values are `null`, never `''` or a sentinel.
 * - Addresses are trimmed and lowercased.
 * - Attachments carry metadata only; objects are strict, so file contents
 *   cannot pass through.
 */
import { z } from 'zod'

const id = z.string().trim().min(1)

/** Optional provider text. Blank text becomes `null`. */
const text = z
  .string()
  .trim()
  .nullable()
  .transform((value) => (value === '' ? null : value))

const timestamp = z.iso.datetime({ offset: true })

const address = z.string().trim().toLowerCase().pipe(z.email())

export const participantSchema = z.strictObject({
  address,
  name: text,
})

const attachmentSchema = z.strictObject({
  filename: text,
  mediaType: text,
  sizeBytes: z.int().nonnegative().nullable(),
})

const messageSchema = z.strictObject({
  id,
  from: participantSchema,
  to: z.array(participantSchema),
  cc: z.array(participantSchema),
  /** From the Date header, which can be missing or malformed. */
  sentAt: timestamp.nullable(),
  /** `null` when no plain-text body is available. */
  bodyText: text,
  attachments: z.array(attachmentSchema),
})

export const mailboxSchema = z.strictObject({
  id,
  address,
})

/**
 * Text as a list shows it. Lists cut long values; a cut value keeps only
 * the start the list showed, never a guessed end, and says it was cut.
 */
const listedTextSchema = z.strictObject({
  text: z.string().trim().min(1),
  cut: z.boolean(),
})

/**
 * One message in a provider's recent-mail list, used to pick a thread to
 * read. Lists can shorten values: `from` is the sender only when the list
 * shows all of it, while `sender` and `subject` hold what the list shows.
 * Missing values are `null`.
 */
export const emailListingSchema = z.strictObject({
  messageId: id,
  mailboxId: id,
  from: participantSchema.nullable(),
  /** The sender's name, or its address when it has none. */
  sender: listedTextSchema.nullable(),
  subject: listedTextSchema.nullable(),
  /** The time the list shows for the message. */
  date: timestamp.nullable(),
})

/** A thread as listed in a mailbox, before its messages are fetched. */
export const emailSummarySchema = z.strictObject({
  threadId: id,
  mailboxId: id,
  subject: text,
  from: participantSchema,
  snippet: text,
  /** Provider receipt time of the latest message, always known. */
  receivedAt: timestamp,
  messageCount: z.int().positive(),
})

export const threadSchema = z
  .strictObject({
    id,
    mailboxId: id,
    subject: text,
    messages: z.array(messageSchema).min(1),
  })
  .refine(
    (thread) =>
      new Set(thread.messages.map((message) => message.id)).size === thread.messages.length,
    { message: 'Message ids must be unique within a thread', path: ['messages'] },
  )
