import { describe, expect, it } from 'vitest'
import { shortcutFor } from './useWorkbenchShortcuts'

type KeyEvent = Parameters<typeof shortcutFor>[0]

const row = '.workbench__queue .message-row__button'

/**
 * A stand-in for the focused element that matches the simple selectors it
 * is given, e.g. `button` or `[role="checkbox"]`. `closest` and `matches`
 * answer from those alone, which is all `shortcutFor` asks.
 */
function focused(...own: string[]) {
  const hit = (selector: string) => selector.split(', ').some((part) => own.includes(part))
  return {
    closest: (selector: string) => (hit(selector) ? {} : null),
    matches: hit,
  } as unknown as EventTarget
}

const region = focused('[tabindex]')

function press(key: string, overrides: Partial<KeyEvent> = {}, actsFrom?: string) {
  return shortcutFor(
    {
      key,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      defaultPrevented: false,
      isComposing: false,
      target: region,
      ...overrides,
    },
    actsFrom,
  )
}

describe('shortcutFor', () => {
  it.each([
    ['k', 'next'],
    ['j', 'previous'],
    ['e', 'complete'],
    ['/', 'search'],
  ])('maps %s to %s', (key, shortcut) => {
    expect(press(key)).toBe(shortcut)
  })

  it('works with nothing focused', () => {
    expect(press('k', { target: null })).toBe('next')
    expect(press('j', { target: null })).toBe('previous')
  })

  it('takes capitals from Shift or Caps Lock', () => {
    expect(press('K')).toBe('next')
    expect(press('J')).toBe('previous')
    expect(press('E')).toBe('complete')
  })

  it('ignores other keys and inherited object keys', () => {
    expect(press('x')).toBeNull()
    expect(press('Enter')).toBeNull()
    expect(press('constructor')).toBeNull()
  })

  it.each([
    ['a text field', focused('input')],
    ['a textarea', focused('textarea')],
    ['a select', focused('select')],
    ['a mailbox filter button', focused('button')],
    ['a checkbox', focused('input')],
    ['a link', focused('a[href]')],
    ['a contenteditable target', focused('[contenteditable]:not([contenteditable="false"])')],
    ['an ARIA checkbox', focused('[role="checkbox"]')],
    ['an ARIA button', focused('[role="button"]')],
  ])('leaves every key to %s', (_, target) => {
    for (const key of ['k', 'j', 'e', '/']) expect(press(key, { target })).toBeNull()
  })

  it('acts from the controls named in actsFrom, and only those', () => {
    const queueRow = focused('button', row)
    expect(press('k', { target: queueRow }, row)).toBe('next')
    expect(press('j', { target: queueRow }, row)).toBe('previous')
    expect(press('k', { target: queueRow })).toBeNull()
    expect(press('j', { target: focused('button') }, row)).toBeNull()
  })

  it.each([
    ['Ctrl', { ctrlKey: true }],
    ['Alt', { altKey: true }],
    ['Cmd', { metaKey: true }],
    ['a handled press', { defaultPrevented: true }],
    ['IME composition', { isComposing: true }],
  ])('ignores %s', (_, overrides) => {
    for (const key of ['k', 'j', 'e', '/']) expect(press(key, overrides)).toBeNull()
  })

  it('ignores modifiers even on the controls named in actsFrom', () => {
    const target = focused('button', row)
    expect(press('k', { target, ctrlKey: true }, row)).toBeNull()
    expect(press('j', { target, altKey: true }, row)).toBeNull()
    expect(press('k', { target, metaKey: true }, row)).toBeNull()
  })
})
