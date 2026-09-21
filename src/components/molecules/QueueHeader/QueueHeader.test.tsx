import type { ReactElement, ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { Button } from '../../atoms/Button/Button'
import { Icon } from '../../atoms/Icon/Icon'
import { QueueHeader } from './QueueHeader'

// QueueHeader is a plain function of its props, so the returned tree shows what
// reaches the DOM. Layout, focus and reflow are checked in Storybook.
type Element = ReactElement<Record<string, unknown>>
type Props = Parameters<typeof QueueHeader>[0]

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
  const root = QueueHeader({ title: 'Needs review', count: '3 results', ...props }) as Element
  const all = descendants(root)
  const byClass = (className: string) =>
    all.find((element) => String(element.props['className']).split(' ').includes(className))
  return { root, all, byClass }
}

describe('QueueHeader', () => {
  it('renders the title as an h2 by default, holding only the title', () => {
    const { root, byClass } = render()
    expect(root.type).toBe('div')
    expect(root.props['className']).toBe('queue-header')
    expect(byClass('queue-header__title')?.type).toBe('h2')
    expect(byClass('queue-header__title')?.props['children']).toBe('Needs review')
  })

  it.each([1, 2, 3] as const)('renders heading level %i', (headingLevel) => {
    expect(render({ headingLevel }).byClass('queue-header__title')?.type).toBe(
      `h${String(headingLevel)}`,
    )
  })

  it('puts the caller id on the heading so a list can reference it', () => {
    expect(render({ titleId: 'queue-title' }).byClass('queue-header__title')?.props['id']).toBe(
      'queue-title',
    )
  })

  it('shows the count beside the title and the context under it', () => {
    const { byClass } = render({ context: 'All accounts · current filter' })
    expect(byClass('queue-header__count')?.props['children']).toBe('3 results')
    expect(byClass('queue-header__context')).toMatchObject({
      type: 'p',
      props: { children: 'All accounts · current filter' },
    })
  })

  it('leaves out the context and the action when not given', () => {
    const { all, byClass } = render({ className: 'extra' })
    expect(byClass('queue-header__context')).toBeUndefined()
    expect(all.some((element) => element.type === Button)).toBe(false)
  })

  it('adds extra classes to the root', () => {
    expect(render({ className: 'extra' }).root.props['className']).toBe('queue-header extra')
  })

  it('renders the action as a secondary Button named by its label', () => {
    const onClick = vi.fn()
    const { all } = render({ action: { label: 'Refresh', onClick } })
    const button = all.find((element) => element.type === Button)
    expect(button?.props).toMatchObject({
      className: 'queue-header__action',
      variant: 'secondary',
      onClick,
      children: [undefined, 'Refresh'],
    })
    expect(button?.props).not.toHaveProperty('aria-label')
    ;(button?.props['onClick'] as () => void)()
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('passes the quiet variant, disabled state and a decorative icon', () => {
    const { all } = render({
      action: {
        label: 'Refresh',
        onClick: vi.fn(),
        variant: 'quiet',
        disabled: true,
        icon: 'check',
      },
    })
    const button = all.find((element) => element.type === Button)
    expect(button?.props).toMatchObject({ variant: 'quiet', disabled: true })
    const [icon] = button?.props['children'] as [Element, string]
    expect(icon.type).toBe(Icon)
    expect(icon.props).toEqual({ name: 'check', size: 'sm' })
  })
})
