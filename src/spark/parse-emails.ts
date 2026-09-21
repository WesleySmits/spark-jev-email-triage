/**
 * Parses `spark emails`: a fixed-width table whose column positions come
 * from its header row. Spark cuts long values and ends them with `…`; a cut
 * value is not the real value, so it becomes unavailable.
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
    from: from === undefined || isCut(from) ? null : parseParticipant(from),
    subject: subject === undefined || isCut(subject) ? null : subject,
    date: localTime(date),
  })
  if (!listing.success) throw malformed(`emails: row ${String(index + 1)} is invalid`)
  return listing.data
}

const isCut = (value: string) => value.endsWith(truncationMark)

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
