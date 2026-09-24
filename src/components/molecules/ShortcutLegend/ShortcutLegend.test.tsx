import type { ReactElement } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { KeyboardHint } from '../../atoms/KeyboardHint/KeyboardHint'
import { ShortcutLegend } from './ShortcutLegend'

type Element = ReactElement<Record<string, unknown>>

const shortcuts = [
  { label: 'Next / previous', keys: ['K', 'J'] },
  { label: 'Complete', keys: ['E'] },
] as const

const setting = {
  label: 'Single-key shortcuts',
  on: true,
  note: 'K, J, E and / act on their own.',
  onChange: () => undefined,
} as const

/** The legend's own parts: the list of rows and the setting, either optional. */
function partsOf(root: Element) {
  const [list, control] = root.props['children'] as [Element | false, Element | false]
  return { list, control }
}

function listOf(props: Parameters<typeof ShortcutLegend>[0]) {
  const { list } = partsOf(ShortcutLegend(props) as Element)
  if (!list) throw new Error('This legend shows no rows')
  // The rows come from the inner Rows component, a function of its props.
  return (list.type as (props: never) => Element)(list.props as never)
}

function rowsOf(props: Parameters<typeof ShortcutLegend>[0]) {
  return (listOf(props).props['children'] as Element[]).map((row) => {
    const [term, detail] = row.props['children'] as [Element, Element]
    const pairs = detail.props['children'] as Element[]
    const content = pairs.flatMap((pair) => pair.props['children'] as [string | false, Element])
    return { row, term, detail, content }
  })
}

/**
 * What the legend hands its setting. The rendered checkbox, its note and the
 * `aria-describedby` between them need a renderer, so Storybook checks those.
 */
function settingOf(props: Parameters<typeof ShortcutLegend>[0]) {
  const { control } = partsOf(ShortcutLegend(props) as Element)
  if (!control) throw new Error('This legend shows no setting')
  return control.props as Parameters<typeof ShortcutLegend>[0]['setting'] & object
}

describe('ShortcutLegend', () => {
  it('pairs each visible label with its keys in a description list', () => {
    const root = ShortcutLegend({ shortcuts }) as Element
    expect(root.type).toBe('div')
    expect(root.props['className']).toBe('shortcut-legend')
    expect(listOf({ shortcuts }).type).toBe('dl')

    const rows = rowsOf({ shortcuts })
    expect(rows).toHaveLength(2)
    for (const [index, { row, term, detail }] of rows.entries()) {
      expect(row.type).toBe('div')
      expect(term.type).toBe('dt')
      expect(term.props['children']).toBe(shortcuts[index]?.label)
      expect(detail.type).toBe('dd')
    }
  })

  it('shows every key as a KeyboardHint, spaced apart for screen readers', () => {
    const [first, second] = rowsOf({ shortcuts })
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

  it('adds a caller class and renders nothing without shortcuts or a setting', () => {
    const root = ShortcutLegend({ shortcuts, className: 'sidebar__keys' }) as Element
    expect(root.props['className']).toBe('shortcut-legend sidebar__keys')
    expect(ShortcutLegend({ shortcuts: [] })).toBeNull()
    expect(partsOf(ShortcutLegend({ shortcuts }) as Element).control).toBe(false)
  })

  it('offers the setting with its label, value and note', () => {
    const onChange = vi.fn()
    const offered = settingOf({ shortcuts, setting: { ...setting, onChange } })
    expect(offered.label).toBe('Single-key shortcuts')
    expect(offered.on).toBe(true)
    expect(offered.note).toBe(setting.note)
    offered.onChange(false)
    expect(onChange).toHaveBeenCalledWith(false)
  })

  it('shows the setting alone, for a legend with no key left to list', () => {
    const off = { label: setting.label, on: false, onChange: setting.onChange } as const
    const root = ShortcutLegend({ shortcuts: [], setting: off }) as Element
    expect(partsOf(root).list).toBe(false)
    const offered = settingOf({ shortcuts: [], setting: off })
    expect(offered.on).toBe(false)
    // Without a note there is nothing for the box to point at.
    expect(offered.note).toBeUndefined()
  })
})
