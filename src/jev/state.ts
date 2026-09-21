/**
 * Builds the minimized state Jev sees for one thread. Every field is picked
 * explicitly, so nothing the domain adds later reaches the provider by
 * accident.
 *
 * Kept: subject, the latest messages' senders and cleaned text, the mailbox
 * owner's role on each message, and attachment names and media types.
 * Dropped: attachment contents and sizes, other recipients, timestamps,
 * and quoted reply history. In every text field (subject, sender name,
 * body, and attachment name), URL queries and fragments and long opaque
 * tokens such as reset links or API keys are removed, and text is truncated
 * to fixed limits.
 */
import type { z } from 'zod'
import { mailboxSchema, type threadSchema } from '../domain/email'

type Thread = z.infer<typeof threadSchema>
type Message = Thread['messages'][number]

export const stateLimits = {
  messages: 5,
  bodyChars: 1500,
  subjectChars: 200,
  nameChars: 100,
  filenameChars: 100,
  attachments: 10,
} as const

type MailboxRole = 'sender' | 'to' | 'cc' | 'not_listed'

/** Inferred rather than declared, so it stays assignable to JSON value types. */
export type TriageState = ReturnType<typeof buildTriageState>

/** Oldest to newest, as in the thread. */
export function buildTriageState(thread: Thread, mailboxAddress: string) {
  const owner = mailboxSchema.shape.address.parse(mailboxAddress)
  const recent = thread.messages.slice(-stateLimits.messages)
  return {
    email_thread: {
      subject: thread.subject === null ? null : cleanLine(thread.subject, stateLimits.subjectChars),
      omitted_earlier_messages: thread.messages.length - recent.length,
      messages: recent.map((message) => stateMessage(message, owner)),
    },
  }
}

function stateMessage(message: Message, owner: string) {
  const text = message.bodyText === null ? null : cleanText(message.bodyText)
  const shown = message.attachments.slice(0, stateLimits.attachments)
  return {
    mailbox_owner_role: mailboxRole(message, owner),
    sender: {
      address: message.from.address,
      name: message.from.name === null ? null : cleanLine(message.from.name, stateLimits.nameChars),
    },
    text: text === null ? null : truncate(text, stateLimits.bodyChars),
    text_truncated: text !== null && text.length > stateLimits.bodyChars,
    attachments: shown.map((attachment) => ({
      filename:
        attachment.filename === null
          ? null
          : cleanLine(attachment.filename, stateLimits.filenameChars),
      media_type: attachment.mediaType,
    })),
    omitted_attachments: message.attachments.length - shown.length,
  }
}

function mailboxRole(message: Message, owner: string): MailboxRole {
  const listed = (participants: Message['to']) => participants.some((p) => p.address === owner)
  if (message.from.address === owner) return 'sender'
  if (listed(message.to)) return 'to'
  if (listed(message.cc)) return 'cc'
  return 'not_listed'
}

const quotedReplyHeader = /^On .+ wrote:\s*$/m
// Trailing punctuation belongs to the sentence, not the link.
const url = /https?:\/\/[^\s<>"'()[\]]*[^\s<>"'()[\].,;:!?]/g
// 20+ characters mixing letters and digits: session ids, reset tokens, keys.
const opaqueToken = /(?=[\w-]*\d)(?=[\w-]*[a-z])[\w-]{20,}/gi

/** The new text of a message, without quoted history or tracking noise. */
function cleanText(text: string): string | null {
  const latest = text.split(quotedReplyHeader)[0] ?? ''
  const unquoted = latest
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('>'))
    .join('\n')
  const cleaned = scrub(unquoted)
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return cleaned === '' ? null : cleaned
}

/** A short header value, scrubbed like body text and truncated. */
const cleanLine = (text: string, maxChars: number) => truncate(scrub(text), maxChars)

/** Strips link queries and fragments, then redacts opaque tokens. */
const scrub = (text: string) => redactTokens(text.replace(url, stripUrl))

/** Keeps the origin and path, which show where a link leads. */
function stripUrl(link: string): string {
  const parsed = URL.parse(link)
  return parsed === null ? '[link]' : `${parsed.origin}${parsed.pathname}`
}

const redactTokens = (text: string) => text.replace(opaqueToken, '[redacted]')

const loneHighSurrogate = /[\uD800-\uDBFF]$/

/** Cuts to `maxChars` UTF-16 units, never inside a surrogate pair. */
function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  return `${text.slice(0, maxChars).replace(loneHighSurrogate, '')}…`
}
