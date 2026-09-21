/**
 * Spark prints times as `YYYY-MM-DD HH:MM` in the Mac's local time zone,
 * without an offset. The caller supplies that zone. A wall time that the
 * zone skips or repeats (daylight saving changes) has no single instant, so
 * it is unavailable rather than guessed.
 */
import { malformed } from './errors'

const wallTimePattern = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/
const minuteMs = 60_000
const dayMs = 24 * 60 * minuteMs

export type LocalTimeZone = (wallTime: string) => string | null

export function localTimeZone(timeZone: string): LocalTimeZone {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  })
  const offsetMinutesAt = (instant: number) => {
    const parts = new Map(
      formatter.formatToParts(instant).map((part) => [part.type, Number(part.value)]),
    )
    const part = (type: Intl.DateTimeFormatPartTypes) => parts.get(type) ?? NaN
    const asUtc = Date.UTC(
      part('year'),
      part('month') - 1,
      part('day'),
      part('hour'),
      part('minute'),
      part('second'),
    )
    return Math.round((asUtc - instant) / minuteMs)
  }

  return (wallTime) => {
    const wallUtc = parseWallTime(wallTime)
    const candidates = new Set([offsetMinutesAt(wallUtc - dayMs), offsetMinutesAt(wallUtc + dayMs)])
    const valid = [...candidates].filter(
      (offset) => offsetMinutesAt(wallUtc - offset * minuteMs) === offset,
    )
    const [offset] = valid
    return valid.length === 1 && offset !== undefined
      ? `${wallTime.replace(' ', 'T')}:00${formatOffset(offset)}`
      : null
  }
}

/** Milliseconds since the epoch if the wall time were UTC. */
function parseWallTime(wallTime: string): number {
  const match = wallTimePattern.exec(wallTime)
  if (!match) throw malformed('unrecognized date format')
  const [year, month, day, hour, minute] = match.slice(1).map(Number) as [
    number,
    number,
    number,
    number,
    number,
  ]
  const utc = new Date(Date.UTC(year, month - 1, day, hour, minute))
  const exists =
    utc.getUTCFullYear() === year &&
    utc.getUTCMonth() === month - 1 &&
    utc.getUTCDate() === day &&
    utc.getUTCHours() === hour &&
    utc.getUTCMinutes() === minute
  if (!exists) throw malformed('date does not exist')
  return utc.getTime()
}

function formatOffset(offsetMinutes: number): string {
  const sign = offsetMinutes < 0 ? '-' : '+'
  const absolute = Math.abs(offsetMinutes)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${sign}${pad(Math.floor(absolute / 60))}:${pad(absolute % 60)}`
}
