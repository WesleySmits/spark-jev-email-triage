import type { ReactElement } from 'react'
import { describe, expect, it } from 'vitest'
import { KeyboardHint } from '../../atoms/KeyboardHint/KeyboardHint'
import { ShortcutLegend } from './ShortcutLegend'

type Element = ReactElement<Record<string, unknown>>

const shortcuts = [
  { label: 'Next / previous', keys: ['K', 'J'] },
  { label: 'Complete', keys: ['E'] },
] as const

function rowsOf(root: Element) {
  return (root.props['children'] as Element[]).map((row) => {
    const [term, detail] = row.props['children'] as [Element, Element]
    const pairs = detail.props['children'] as Element[]
    const content = pairs.flatMap((pair) => pair.props['children'] as [string | false, Element])
    return { row, term, detail, content }
  })
}

describe('ShortcutLegend', () => {
  it('pairs each visible label with its keys in a description list', () => {
    const root = ShortcutLegend({ shortcuts }) as Element
    expect(root.type).toBe('dl')
    expect(root.props['className']).toBe('shortcut-legend')

    const rows = rowsOf(root)
    expect(rows).toHaveLength(2)
    for (const [index, { row, term, detail }] of rows.entries()) {
      expect(row.type).toBe('div')
      expect(term.type).toBe('dt')
      expect(term.props['children']).toBe(shortcuts[index]?.label)
      expect(detail.type).toBe('dd')
    }
  })

  it('shows every key as a KeyboardHint, spaced apart for screen readers', () => {
    const [first, second] = rowsOf(ShortcutLegend({ shortcuts }) as Element)
    const keys = (content: (string | false | Element)[]) =>
      content.map((item) =>
        typeof item === 'object' ? { hint: item.type, key: item.props['children'] } : item,
      )
    expect(keys(first?.content ?? [])).toEqual([
      false,
      { hint: KeyboardHint, key: 'K' },
      ' ',
      { hint: KeyboardHint, key: 'J' },
    ])
    expect(keys(second?.content ?? [])).toEqual([false, { hint: KeyboardHint, key: 'E' }])
  })

  it('adds a caller class and renders nothing without shortcuts', () => {
    const root = ShortcutLegend({ shortcuts, className: 'sidebar__keys' }) as Element
    expect(root.props['className']).toBe('shortcut-legend sidebar__keys')
    expect(ShortcutLegend({ shortcuts: [] })).toBeNull()
  })
})
