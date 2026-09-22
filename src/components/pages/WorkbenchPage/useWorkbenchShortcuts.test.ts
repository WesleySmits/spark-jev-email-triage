import { describe, expect, it } from 'vitest'
import { shortcutFor } from './useWorkbenchShortcuts'

type KeyEvent = Parameters<typeof shortcutFor>[0]

// A stand-in for the focused element: `closest` answers whether it types text.
const field = { closest: () => ({}) } as unknown as EventTarget
const button = { closest: () => null } as unknown as EventTarget

function press(key: string, overrides: Partial<KeyEvent> = {}) {
  return shortcutFor({
    key,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    defaultPrevented: false,
    isComposing: false,
    target: button,
    ...overrides,
  })
}

describe('shortcutFor', () => {
  it.each([
    ['j', 'next'],
    ['k', 'previous'],
    ['e', 'complete'],
    ['/', 'search'],
  ])('maps %s to %s', (key, shortcut) => {
    expect(press(key)).toBe(shortcut)
  })

  it('works with nothing focused', () => {
    expect(press('j', { target: null })).toBe('next')
  })

  it('ignores other keys, capitals and inherited object keys', () => {
    expect(press('x')).toBeNull()
    expect(press('J')).toBeNull()
    expect(press('constructor')).toBeNull()
  })

  it('leaves typing in text fields alone', () => {
    expect(press('j', { target: field })).toBeNull()
    expect(press('/', { target: field })).toBeNull()
  })

  it.each([
    ['Ctrl', { ctrlKey: true }],
    ['Alt', { altKey: true }],
    ['Cmd', { metaKey: true }],
    ['a handled press', { defaultPrevented: true }],
    ['IME composition', { isComposing: true }],
  ])('ignores %s', (_, overrides) => {
    expect(press('e', overrides)).toBeNull()
  })
})
