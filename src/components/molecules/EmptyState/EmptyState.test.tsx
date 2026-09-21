import type { ReactElement, ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { Button } from '../../atoms/Button/Button'
import { Icon } from '../../atoms/Icon/Icon'
import { EmptyState } from './EmptyState'

// EmptyState is a plain function of its props, so the returned tree shows what
// reaches the DOM. Focus, reflow and contrast are checked in Storybook.
type Element = ReactElement<Record<string, unknown>>
type Props = Parameters<typeof EmptyState>[0]

function isElement(node: unknown): node is Element {
  return typeof node === 'object' && node !== null && 'props' in node
}

function descendants(element: Element): Element[] {
  return ([] as ReactNode[])
    .concat(element.props['children'] as ReactNode)
    .filter(isElement)
    .flatMap((child) => [child, ...descendants(child)])
}

function render(props: Partial<Props> = {}) {
  const root = EmptyState({
    title: 'No results in this filter',
    description: 'Choose another queue or mailbox.',
    ...props,
  }) as Element
  const all = descendants(root)
  const heading = all.find((element) => element.props['className'] === 'empty-state__title')
  const description = all.find((element) => element.type === 'p')
  const icons = all.filter((element) => element.type === Icon)
  const buttons = all.filter((element) => element.type === Button)
  return { root, all, heading, description, icons, buttons }
}

describe('EmptyState', () => {
  it('renders the title as a level 2 heading and the description as a paragraph', () => {
    const { root, heading, description } = render()
    expect(root.type).toBe('div')
    expect(root.props['className']).toBe('empty-state')
    expect(root.props).not.toHaveProperty('role')
    expect(root.props).not.toHaveProperty('aria-live')
    expect(heading?.type).toBe('h2')
    expect(heading?.props['children']).toBe('No results in this filter')
    expect(description?.props['children']).toBe('Choose another queue or mailbox.')
  })

  it('uses the caller heading level and id', () => {
    const { heading } = render({ headingLevel: 3, titleId: 'empty-title' })
    expect(heading?.type).toBe('h3')
    expect(heading?.props['id']).toBe('empty-title')
  })

  it('renders only copy without an icon or action', () => {
    const { icons, buttons } = render()
    expect(icons).toEqual([])
    expect(buttons).toEqual([])
  })

  it('keeps the icon decorative', () => {
    const { icons } = render({ icon: 'inbox' })
    expect(icons).toHaveLength(1)
    expect(icons[0]?.props).toEqual({ name: 'inbox' })
  })

  it('wires the caller-owned action to a secondary button by default', () => {
    const onClick = vi.fn()
    const { buttons } = render({ action: { label: 'Show all mailboxes', onClick } })
    expect(buttons).toHaveLength(1)
    expect(buttons[0]?.props).toMatchObject({
      className: 'empty-state__action',
      variant: 'secondary',
      onClick,
    })
    expect(buttons[0]?.props).not.toHaveProperty('aria-label')
    expect(onClick).not.toHaveBeenCalled()
  })

  it('allows a quiet action with a decorative small icon before the label', () => {
    const { buttons } = render({
      action: { label: 'Search all mail', icon: 'search', variant: 'quiet', onClick: vi.fn() },
    })
    expect(buttons[0]?.props['variant']).toBe('quiet')
    const [icon, label] = buttons[0]?.props['children'] as [Element, string]
    expect(icon.type).toBe(Icon)
    expect(icon.props).toEqual({ name: 'search', size: 'sm' })
    expect(label).toBe('Search all mail')
  })

  it('appends the caller class name', () => {
    expect(render({ className: 'queue__empty' }).root.props['className']).toBe(
      'empty-state queue__empty',
    )
  })
})
