import { readFileSync } from 'node:fs'
import { parse } from 'postcss'
import type * as React from 'react'
import type { KeyboardEvent, MouseEvent, ReactElement } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { IconButton } from '../../atoms/IconButton/IconButton'
import { FilterSheet } from './FilterSheet'

// FilterSheet only places what it is given: `showModal`, the focus trap,
// Escape and the focus return are the browser's, and are checked in Storybook.
// Replacing the two hooks it uses lets the test call it as a plain function
// and walk the element it returns.
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof React>()),
  useRef: () => ({ current: null }),
  useEffect: () => undefined,
}))

type Element = ReactElement<Record<string, unknown>>
type Props = Parameters<typeof FilterSheet>[0]

const base: Props = {
  label: 'Filters',
  open: false,
  onClose: vi.fn(),
  children: <p>Filters</p>,
}

function render(overrides: Partial<Props> = {}) {
  const root = FilterSheet({ ...base, ...overrides }) as Element
  const [bar, body] = root.props['children'] as Element[]
  if (!bar || !body) throw new Error('Missing sheet part')
  const [title, close] = bar.props['children'] as Element[]
  if (!title || !close) throw new Error('Missing bar part')
  return { root, bar, title, close, body }
}

function css() {
  return parse(readFileSync(new URL('./FilterSheet.css', import.meta.url), 'utf8'))
}

describe('FilterSheet', () => {
  it('is a dialog named by its label, with that label above what it holds', () => {
    const { root, title, body } = render({ className: 'extra' })
    expect(root.type).toBe('dialog')
    expect(root.props).toMatchObject({ 'aria-label': 'Filters', className: 'filter-sheet extra' })
    expect(title.props['children']).toBe('Filters')
    expect(body.props).toEqual({ className: 'filter-sheet__body', children: base.children })
  })

  it('closes from the close button, which the label names', () => {
    const onClose = vi.fn()
    const { close } = render({ onClose })
    expect(close.type).toBe(IconButton)
    expect(close.props).toMatchObject({ icon: 'close', label: 'Close filters' })
    ;(close.props['onClick'] as () => void)()
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('takes the caller name for the close button', () => {
    expect(render({ closeLabel: 'Filters sluiten' }).close.props['label']).toBe('Filters sluiten')
  })

  it('reports the browser closing it', () => {
    const onClose = vi.fn()
    expect(render({ onClose }).root.props['onClose']).toBe(onClose)
  })

  it('closes on Escape and leaves every other key alone', () => {
    const onClose = vi.fn()
    const onKeyDown = render({ onClose }).root.props['onKeyDown'] as (
      event: Pick<KeyboardEvent<HTMLDialogElement>, 'key'>,
    ) => void
    onKeyDown({ key: 'k' })
    expect(onClose).not.toHaveBeenCalled()
    onKeyDown({ key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('stays open on a click inside it, so only the backdrop closes it', () => {
    const onClose = vi.fn()
    const onClick = render({ onClose }).root.props['onClick'] as (
      event: Pick<MouseEvent<HTMLDialogElement>, 'target'>,
    ) => void
    onClick({ target: {} as EventTarget })
    expect(onClose).not.toHaveBeenCalled()
  })

  it('styles with tokens only', () => {
    const values: string[] = []
    css().walkDecls((declaration) => {
      values.push(declaration.value)
    })
    expect(values.filter((value) => /#[0-9a-f]{3,8}\b/i.test(value))).toEqual([])
  })

  it('leaves the layout and the tab order while it is closed', () => {
    const closed = new Map<string, string>()
    css().walkRules('.filter-sheet:not([open])', (rule) => {
      rule.walkDecls((declaration) => {
        closed.set(declaration.prop, declaration.value)
      })
    })
    expect(closed.get('display')).toBe('none')
  })
})
