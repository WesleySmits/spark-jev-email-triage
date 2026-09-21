import type { z } from 'zod'
import { participantSchema } from '../domain/email'

type Participant = z.infer<typeof participantSchema>

const namedAddress = /^(.*?)\s*<([^<>\s]+)>$/

/** Parses `Name <address>` or a bare address. Returns `null` if neither. */
export function parseParticipant(value: string): Participant | null {
  const match = namedAddress.exec(value.trim())
  const input = match
    ? { name: unquote(match[1] ?? ''), address: match[2] }
    : { name: null, address: value.trim() }
  const result = participantSchema.safeParse(input)
  return result.success ? result.data : null
}

// An empty group such as `undisclosed-recipients:;` names no one.
const emptyGroup = /^[^<>@"]*:;$/

/**
 * Parses a comma-separated recipient list. Commas inside quotes or angle
 * brackets belong to the name or address. Returns `null` if any entry is
 * not a participant.
 */
export function parseParticipantList(value: string): Participant[] | null {
  const participants = splitRecipients(value)
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '' && !emptyGroup.test(entry))
    .map(parseParticipant)
  return participants.every((participant) => participant !== null) ? participants : null
}

function splitRecipients(value: string): string[] {
  const entries: string[] = []
  let current = ''
  let quoted = false
  let bracketed = false
  for (const char of value) {
    if (char === '"') quoted = !quoted
    else if (char === '<') bracketed = true
    else if (char === '>') bracketed = false
    if (char === ',' && !quoted && !bracketed) {
      entries.push(current)
      current = ''
    } else {
      current += char
    }
  }
  entries.push(current)
  return entries
}

function unquote(name: string): string {
  const trimmed = name.trim()
  return trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')
    ? trimmed.slice(1, -1)
    : trimmed
}
