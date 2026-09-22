/**
 * Parses `spark emails`: a fixed-width table whose column positions come
 * from its header row. Spark 1.3.1 shows at most 30 characters of From and
 * 50 of Subject, and ends a longer value with `…`; its documented options
 * offer no structured or uncut form of this list. A cut value keeps the
 * start Spark showed and is marked cut, so it is never taken for the
 * complete sender or subject.
 */
import type { z } from 'zod'
import { emailListingSchema } from '../domain/email'
import { malformed } from './errors'
import { wallTimePattern, type LocalTimeZone } from './local-time'
import { parseParticipant } from './participants'

type EmailListing = z.infer<typeof emailListingSchema>

const columns = ['ID', 'Account', 'From', 'Date', 'Subject', 'Flags'] as const
const headerPattern = /^\s*ID\s+Account\s+From\s+Date\s+Subject\s+Flags\s*$/
const idPattern = /^[1-9][0-9]*$/
const truncationMark = '…'

interface ListContext {
  mailboxId: string
  limit: number
  localTime: LocalTimeZone
}

export function parseEmailList(stdout: string, context: ListContext): EmailListing[] {
  const lines = stdout.split(/\r?\n/)
  const headerIndex = lines.findIndex((line) => headerPattern.test(line))
  if (headerIndex === -1) {
    if (lines.some((line) => line.trim() === 'No emails found.')) return []
    throw malformed('emails: missing table header')
  }
  const offsets = columnOffsets(lines[headerIndex] ?? '')
  const rows = rowsAfter(lines, headerIndex)
  if (rows.length === 0 || rows.length > context.limit) {
    throw malformed(`emails: expected 1 to ${String(context.limit)} rows`)
  }
  return rows.map((row, index) => parseRow(row, offsets, index, context))
}

function columnOffsets(header: string): number[] {
  let from = 0
  return columns.map((column) => {
    from = header.indexOf(column, from)
    return from
  })
}

/** Table rows run from the header to the first blank line. */
function rowsAfter(lines: string[], headerIndex: number): string[] {
  const rest = lines.slice(headerIndex + 1)
  const end = rest.findIndex((line) => line.trim() === '')
  return end === -1 ? rest : rest.slice(0, end)
}

function parseRow(
  row: string,
  offsets: number[],
  index: number,
  { mailboxId, localTime }: ListContext,
): EmailListing {
  // Spark pads columns by UTF-16 code unit, the same unit `slice` counts.
  const [id, , from, date, subject] = offsets.map((start, column) =>
    row.slice(start, offsets[column + 1]).trim(),
  )
  if (id === undefined || date === undefined || !isAligned(row, offsets, id, date)) {
    throw malformed(`emails: row ${String(index + 1)} is misaligned`)
  }
  const listing = emailListingSchema.safeParse({
    messageId: id,
    mailboxId,
    ...listedSender(from ?? ''),
    subject: listed(subject ?? ''),
    date: localTime(date),
  })
  if (!listing.success) throw malformed(`emails: row ${String(index + 1)} is invalid`)
  return listing.data
}

const isCut = (value: string) => value.endsWith(truncationMark)

type ListedText = EmailListing['subject']

/** A cell as shown: blank is `null`, and a cut value keeps its visible start. */
const listed = (cell: string): ListedText =>
  isCut(cell) ? cutText(cell.slice(0, -truncationMark.length)) : whole(cell)

const whole = (value: string): ListedText => {
  const text = value.trim()
  return text === '' ? null : { text, cut: false }
}

/**
 * Spark cuts by UTF-16 code unit, so a cut can split a surrogate pair;
 * the orphaned half is dropped.
 */
function cutText(visible: string): ListedText {
  const text = visible.replace(/[\uD800-\uDBFF]$/, '').trim()
  return text === '' ? null : { text, cut: true }
}

/**
 * The sender a From cell shows. A whole `Name <address>` or address is
 * parsed. A cut one still has its whole name once the address has begun,
 * as in `Name <addr…`, so only the address is lost. Anything else shows
 * as Spark printed it.
 */
function listedSender(cell: string): Pick<EmailListing, 'from' | 'sender'> {
  if (!isCut(cell)) {
    const from = parseParticipant(cell)
    const text = from === null ? cell : (from.name ?? from.address)
    return { from, sender: whole(text) }
  }
  const visible = cell.slice(0, -truncationMark.length).trim()
  return { from: null, sender: wholeName(visible) ?? cutText(afterName(visible)) }
}

/** The name of a cut `Name <addr…` or `"Last, First" <addr…`, if it is whole. */
function wholeName(visible: string): ListedText {
  const quoted = /^"([^"]*)"\s*</.exec(visible)
  if (quoted) return whole(quoted[1] ?? '')
  const bracket = visible.indexOf('<')
  return visible.startsWith('"') || bracket < 1 ? null : whole(visible.slice(0, bracket))
}

/** The rest of a cut sender without a whole name: its address, or the name without its open quote. */
function afterName(visible: string): string {
  const bracket = visible.lastIndexOf('<')
  return bracket === -1 ? visible.replace(/^"/, '') : visible.slice(bracket + 1)
}

/**
 * Spark pads every cell, so a row whose columns shifted shows up as text
 * running into a column boundary, or as an ID or Date cell of the wrong
 * shape. A blank or impossible date is still aligned and becomes
 * unavailable.
 */
function isAligned(row: string, offsets: number[], id: string, date: string): boolean {
  const padded = offsets.slice(1).every((start) => start >= row.length || row[start - 1] === ' ')
  return padded && idPattern.test(id) && (date === '' || wallTimePattern.test(date))
}
