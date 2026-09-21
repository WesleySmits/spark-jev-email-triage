import type { ReactElement, ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { Button } from '../../atoms/Button/Button'
import { Checkbox } from '../../atoms/Checkbox/Checkbox'
import { Icon } from '../../atoms/Icon/Icon'
import { BulkActionBar } from './BulkActionBar'

// BulkActionBar is a plain function of its props, so the returned tree shows
// what it composes. The action buttons are resolved one level so their Button
// props are visible. Layout, focus and reflow are checked in Storybook.
type Element = ReactElement<Record<string, unknown>>
type Props = Parameters<typeof BulkActionBar>[0]

function isElement(node: unknown): node is Element {
  return typeof node === 'object' && node !== null && 'props' in node
}

function expand(element: Element): Element {
  return typeof element.type === 'function' && element.type !== Button && element.type !== Checkbox
    ? (element.type as (props: unknown) => Element)(element.props)
    : element
}

function descendants(element: Element): Element[] {
  return ([] as ReactNode[])
    .concat(element.props['children'] as ReactNode)
    .filter(isElement)
    .map(expand)
    .flatMap((child) => [child, ...descendants(child)])
}

function render(props: Partial<Props> = {}) {
  const root = BulkActionBar({
    label: 'Bulk actions',
    count: '3 results selected',
    ...props,
  }) as Element
  const all = descendants(root)
  const byClass = (className: string) =>
    all.find((element) => String(element.props['className']).split(' ').includes(className))
  const buttons = all.filter((element) => element.type === Button)
  return { root, all, byClass, buttons }
}

describe('BulkActionBar', () => {
  it('is a group named by its label', () => {
    const { root } = render()
    expect(root.type).toBe('div')
    expect(root.props).toMatchObject({
      role: 'group',
      'aria-label': 'Bulk actions',
      className: 'bulk-action-bar',
    })
  })

  it('shows the count emphasized, followed by the scope', () => {
    const { byClass } = render({ context: 'within current filter' })
    const count = byClass('bulk-action-bar__count')
    expect(count?.props).toMatchObject({
      className: 'bulk-action-bar__count bulk-action-bar__count--selected',
      children: '3 results selected',
    })
    expect(byClass('bulk-action-bar__summary')?.type).toBe('p')
    const [, context] = byClass('bulk-action-bar__summary')?.props['children'] as [Element, Element]
    expect(context.props['children']).toEqual([' ', 'within current filter'])
  })

  it('does not emphasize a prompt when nothing is selected', () => {
    const { byClass } = render({ count: 'Select visible results', hasSelection: false })
    expect(byClass('bulk-action-bar__count')?.props['className']).toBe('bulk-action-bar__count')
  })

  it('leaves out the checkbox, context and action group when not given', () => {
    const { all, byClass } = render({ actions: [] })
    expect(all.some((element) => element.type === Checkbox)).toBe(false)
    expect(byClass('bulk-action-bar__actions')).toBeUndefined()
    const [, context] = byClass('bulk-action-bar__summary')?.props['children'] as [Element, unknown]
    expect(context).toBeUndefined()
  })

  it('adds extra classes to the root', () => {
    expect(render({ className: 'extra' }).root.props['className']).toBe('bulk-action-bar extra')
  })

  it('passes the caller-owned select-all state to a Checkbox with a hidden label', () => {
    const onChange = vi.fn()
    const { all } = render({
      selectAll: {
        label: 'Select all visible results',
        checked: false,
        indeterminate: true,
        disabled: true,
        onChange,
      },
    })
    const checkbox = all.find((element) => element.type === Checkbox)
    expect(checkbox?.props).toEqual({
      label: 'Select all visible results',
      checked: false,
      indeterminate: true,
      disabled: true,
      onChange,
      hideLabel: true,
    })
  })

  it('renders each action as a secondary Button named by its visible label', () => {
    const complete = vi.fn()
    const clear = vi.fn()
    const { buttons } = render({
      actions: [
        { label: 'Complete', onClick: complete },
        { label: 'Clear selection', variant: 'quiet', onClick: clear },
      ],
    })
    expect(buttons.map((button) => button.props['children'])).toEqual([
      [undefined, 'Complete'],
      [undefined, 'Clear selection'],
    ])
    expect(buttons[0]?.props).toMatchObject({
      className: 'bulk-action-bar__action',
      variant: 'secondary',
      'aria-label': undefined,
    })
    expect(buttons[1]?.props['variant']).toBe('quiet')
    ;(buttons[1]?.props['onClick'] as () => void)()
    expect(clear).toHaveBeenCalledOnce()
    expect(complete).not.toHaveBeenCalled()
  })

  it('passes the primary variant, disabled state, accessible label and a decorative icon', () => {
    const { buttons } = render({
      actions: [
        {
          label: 'Complete 3',
          accessibleLabel: 'Complete 3 selected results',
          icon: 'check',
          variant: 'primary',
          disabled: true,
          onClick: vi.fn(),
        },
      ],
    })
    expect(buttons[0]?.props).toMatchObject({
      variant: 'primary',
      disabled: true,
      'aria-label': 'Complete 3 selected results',
    })
    const [icon] = buttons[0]?.props['children'] as [Element, string]
    expect(icon.type).toBe(Icon)
    expect(icon.props).toEqual({ name: 'check', size: 'sm' })
  })
})
