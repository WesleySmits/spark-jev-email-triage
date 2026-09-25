import { describe, expect, it } from 'vitest'
import { legendFor, shortcutFor, shortcutLegend } from './useWorkbenchShortcuts'

type KeyEvent = Parameters<typeof shortcutFor>[0]
type Context = NonNullable<Parameters<typeof shortcutFor>[1]>

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

function press(key: string, overrides: Partial<KeyEvent> = {}, context: Context = {}) {
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
    context,
  )
}

const singleKeys = ['k', 'j', 'g', 'e', '/']
// Keys the browser and the controls own. They are no shortcut in either mode.
const ownKeys = ['Tab', 'Enter', 'Escape', 'ArrowDown', ' ']

describe('shortcutFor', () => {
  it.each([
    ['k', 'next'],
    ['j', 'previous'],
    ['g', 'group'],
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
    for (const key of ['k', 'j', 'g', 'e', '/']) expect(press(key, { target })).toBeNull()
  })

  it('acts from the controls named in actsFrom, and only those', () => {
    const queueRow = focused('button', row)
    expect(press('k', { target: queueRow }, { actsFrom: row })).toBe('next')
    expect(press('j', { target: queueRow }, { actsFrom: row })).toBe('previous')
    expect(press('k', { target: queueRow })).toBeNull()
    expect(press('j', { target: focused('button') }, { actsFrom: row })).toBeNull()
  })

  it.each([
    ['Ctrl', { ctrlKey: true }],
    ['Alt', { altKey: true }],
    ['Cmd', { metaKey: true }],
    ['a handled press', { defaultPrevented: true }],
    ['IME composition', { isComposing: true }],
  ])('ignores %s', (_, overrides) => {
    for (const key of ['k', 'j', 'g', 'e', '/']) expect(press(key, overrides)).toBeNull()
  })

  it('ignores modifiers even on the controls named in actsFrom', () => {
    const target = focused('button', row)
    expect(press('k', { target, ctrlKey: true }, { actsFrom: row })).toBeNull()
    expect(press('j', { target, altKey: true }, { actsFrom: row })).toBeNull()
    expect(press('k', { target, metaKey: true }, { actsFrom: row })).toBeNull()
  })

  it('leaves Tab, Enter and Escape alone in either mode', () => {
    for (const key of ownKeys) {
      expect(press(key)).toBeNull()
      expect(press(key, {}, { singleKeys: false })).toBeNull()
    }
  })
})

describe('shortcutFor with the single keys turned off', () => {
  const off = { singleKeys: false } as const

  it('means nothing for a key of one character, capital or not', () => {
    for (const key of [...singleKeys, 'K', 'J', 'E']) {
      expect(press(key, {}, off)).toBeNull()
    }
  })

  it('means nothing on the controls the keys otherwise act from', () => {
    const queueRow = focused('button', row)
    for (const key of singleKeys) {
      expect(press(key, { target: queueRow }, { ...off, actsFrom: row })).toBeNull()
    }
  })

  it('leaves typing in a field to the field, as it does when on', () => {
    for (const key of singleKeys) {
      expect(press(key, { target: focused('input') }, off)).toBeNull()
      expect(press(key, { target: focused('input') })).toBeNull()
    }
  })

  it('means nothing during IME composition either', () => {
    for (const key of singleKeys) {
      expect(press(key, { isComposing: true }, off)).toBeNull()
      expect(press(key, { isComposing: true })).toBeNull()
    }
  })

  it('acts again once the keys are back on', () => {
    expect(press('k', {}, { singleKeys: true })).toBe('next')
    expect(press('k')).toBe('next')
  })
})

describe('legendFor', () => {
  it('lists nothing while the keys are off', () => {
    expect(legendFor({ singleKeys: false, canComplete: true })).toEqual([])
    expect(legendFor({ singleKeys: false, canComplete: false })).toEqual([])
  })

  it('lists every shortcut where Complete is offered', () => {
    expect(legendFor({ singleKeys: true, canComplete: true, canGroup: true })).toEqual(
      shortcutLegend,
    )
  })

  it('leaves out Complete where the page cannot complete', () => {
    expect(legendFor({ singleKeys: true, canComplete: false }).map((item) => item.label)).toEqual([
      'Next / previous',
    ])
  })

  it('lists Next group only where the queue is grouped', () => {
    expect(
      legendFor({ singleKeys: true, canComplete: false, canGroup: true }).map((item) => item.label),
    ).toEqual(['Next / previous', 'Next group'])
    expect(legendFor({ singleKeys: true, canComplete: true }).map((item) => item.label)).toEqual([
      'Next / previous',
      'Complete',
    ])
  })
})
