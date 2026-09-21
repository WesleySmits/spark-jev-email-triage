/**
 * Parses `spark thread`: a preamble (`Thread:`, `Messages:`, optional
 * `Labels:`, `Link:`) and one block per message, separated by unindented
 * rules. Each block holds two-space-indented `Key: value` headers, a blank
 * line, the indented plain-text body, and an optional attachment table.
 *
 * Spark prints no thread id or mailbox, so the thread id is its first
 * message id and the mailbox comes from the caller.
 */
import type { z } from 'zod'
import { threadSchema } from '../domain/email'
import { malformed } from './errors'
import type { LocalTimeZone } from './local-time'
import { parseParticipant, parseParticipantList } from './participants'

type Thread = z.infer<typeof threadSchema>
type Message = Thread['messages'][number]
type Attachment = Message['attachments'][number]

const rulePattern = /^─{10,}$/
const headerPattern = /^ {2}([A-Za-z][A-Za-z-]*): ?(.*)$/
const attachmentHeaderPattern = /^ {4}ID\s+Name\s+Size\s+MIME Type\s+Path\s*$/
const attachmentRowPattern =
  /^ {4}(\d+) {2,}(.*?) {2,}(\d[\d.,]* ?[A-Za-z]+) {2,}(\S+\/\S+)(?: {2,}.*)?$/
const exactBytesPattern = /^(\d+) ?(?:B|bytes?)$/

interface ThreadContext {
  mailboxId: string
  messageId: string
  localTime: LocalTimeZone
}

interface Block {
  id: string
  type: string
  message: Message
}

export function parseThread(stdout: string, context: ThreadContext): Thread {
  const [preamble = [], ...chunks] = splitOnRules(stdout.split(/\r?\n/))
  const { subject, messageCount } = parsePreamble(preamble)
  const blocks = chunks
    .filter((chunk) => chunk.some((line) => line.trim() !== ''))
    .map((chunk, index) => parseBlock(chunk, index, context.localTime))
  if (blocks.length !== messageCount) throw malformed('thread: message count does not match')
  if (!blocks.some((block) => block.id === context.messageId)) {
    throw malformed('thread: requested message is missing')
  }
  // Other block types, such as team comments, are not email content.
  const messages = blocks.filter((block) => block.type === 'Email').map((block) => block.message)
  const thread = threadSchema.safeParse({
    id: messages[0]?.id,
    mailboxId: context.mailboxId,
    subject,
    messages,
  })
  if (!thread.success) throw malformed('thread: does not match the thread schema')
  return thread.data
}

function splitOnRules(lines: string[]): string[][] {
  const chunks: string[][] = [[]]
  for (const line of lines) {
    if (rulePattern.test(line)) chunks.push([])
    else chunks.at(-1)?.push(line)
  }
  return chunks
}

function parsePreamble(lines: string[]) {
  const value = (key: string) =>
    lines.find((line) => line.startsWith(`${key}:`))?.slice(key.length + 1)
  const subject = value('Thread')
  const messageCount = Number(value('Messages')?.trim())
  if (subject === undefined || !Number.isInteger(messageCount) || messageCount < 1) {
    throw malformed('thread: missing thread summary')
  }
  return { subject, messageCount }
}

function parseBlock(chunk: string[], index: number, localTime: LocalTimeZone): Block {
  const position = `thread: message ${String(index + 1)}`
  const lines = chunk.slice(chunk.findIndex((line) => line !== ''))
  const headerEnd = lines.includes('') ? lines.indexOf('') : lines.length
  const headers = parseHeaders(lines.slice(0, headerEnd), position)
  const header = (key: string) => headers.get(key) ?? ''
  const id = required(headers.get('id'), position)
  const date = headers.get('date')
  const { bodyText, attachments } = parseContent(lines.slice(headerEnd + 1), position)
  return {
    id,
    type: required(headers.get('type'), position),
    message: {
      id,
      from: required(parseParticipant(header('from')), position),
      to: required(parseParticipantList(header('to')), position),
      cc: required(parseParticipantList(header('cc')), position),
      sentAt: date === undefined ? null : localTime(date),
      bodyText,
      attachments,
    },
  }
}

function required<T>(value: T | null | undefined, position: string): T {
  if (value === null || value === undefined) {
    throw malformed(`${position} has missing or invalid headers`)
  }
  return value
}

function parseHeaders(lines: string[], position: string): Map<string, string> {
  const headers = new Map<string, string>()
  for (const line of lines) {
    const match = headerPattern.exec(line)
    if (!match?.[1] || match[2] === undefined) {
      throw malformed(`${position} has an unreadable header`)
    }
    headers.set(match[1].toLowerCase(), match[2].trim())
  }
  return headers
}

/** Splits the lines after the headers into body text and attachments. */
function parseContent(lines: string[], position: string) {
  // The table is the last section, so a body line reading `Attachments:`
  // cannot be mistaken for it.
  const tableStart = lines.reduce(
    (found, line, index) =>
      line === '  Attachments:' && attachmentHeaderPattern.test(lines[index + 1] ?? '')
        ? index
        : found,
    -1,
  )
  const bodyLines = tableStart === -1 ? lines : lines.slice(0, tableStart)
  const tableRows = tableStart === -1 ? [] : lines.slice(tableStart + 2)
  const rowsEnd = tableRows.findIndex((line) => line.trim() === '')
  return {
    bodyText: bodyLines.map((line) => line.replace(/^ {1,2}/, '')).join('\n'),
    attachments: (rowsEnd === -1 ? tableRows : tableRows.slice(0, rowsEnd)).map((row) =>
      parseAttachment(row, position),
    ),
  }
}

function parseAttachment(row: string, position: string): Attachment {
  const [, , name, size, mediaType] = attachmentRowPattern.exec(row) ?? []
  if (name === undefined || size === undefined || mediaType === undefined) {
    throw malformed(`${position} has an unreadable attachment row`)
  }
  // Sizes such as `1,2 MB` are rounded, so only exact byte counts are kept.
  const exactBytes = exactBytesPattern.exec(size)?.[1]
  return {
    filename: name.endsWith('…') ? null : name,
    mediaType,
    sizeBytes: exactBytes === undefined ? null : Number(exactBytes),
  }
}
