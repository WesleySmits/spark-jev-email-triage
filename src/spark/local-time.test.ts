import { describe, expect, it } from 'vitest'
import { localTimeZone } from './local-time'

describe('localTimeZone', () => {
  const amsterdam = localTimeZone('Europe/Amsterdam')

  it.each([
    ['winter time', '2026-01-10 10:00', '2026-01-10T10:00:00+01:00'],
    ['summer time', '2026-07-01 09:30', '2026-07-01T09:30:00+02:00'],
    ['the first minute after the spring change', '2026-03-29 03:00', '2026-03-29T03:00:00+02:00'],
  ])('adds the offset in %s', (_, wallTime, expected) => {
    expect(amsterdam(wallTime)).toBe(expected)
  })

  it.each([
    ['skipped by the spring change', '2026-03-29 02:30'],
    ['repeated by the autumn change', '2026-10-25 02:30'],
  ])('treats a time %s as unavailable', (_, wallTime) => {
    expect(amsterdam(wallTime)).toBeNull()
  })

  it('handles zones west of UTC and half-hour offsets', () => {
    expect(localTimeZone('America/New_York')('2026-01-10 10:00')).toBe('2026-01-10T10:00:00-05:00')
    expect(localTimeZone('Asia/Kolkata')('2026-01-10 10:00')).toBe('2026-01-10T10:00:00+05:30')
    expect(localTimeZone('UTC')('2026-01-10 10:00')).toBe('2026-01-10T10:00:00+00:00')
  })

  it.each([
    '',
    '   ',
    '2026-01-10T10:00',
    '10/01/2026 10:00',
    '2026-02-30 10:00',
    '2026-01-10 24:00',
  ])('treats %o as unavailable', (wallTime) => {
    expect(amsterdam(wallTime)).toBeNull()
  })

  it('ignores surrounding whitespace', () => {
    expect(amsterdam(' 2026-01-10 10:00 ')).toBe('2026-01-10T10:00:00+01:00')
  })

  it('rejects an unknown time zone', () => {
    expect(() => localTimeZone('Mars/Olympus_Mons')).toThrow(RangeError)
  })
})
