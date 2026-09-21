import type { ReactElement, ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { Button } from '../../atoms/Button/Button'
import { Icon } from '../../atoms/Icon/Icon'
import { KeyboardHint } from '../../atoms/KeyboardHint/KeyboardHint'
import { ReaderActionBar } from './ReaderActionBar'

// ReaderActionBar is a plain function of its props. Its buttons are rendered
// by calling the inner component, so the tree shows the Buttons it composes.
// Focus, wrapping and contrast are checked in Storybook.
type Element = ReactElement<Record<string, unknown>>
type Props = Parameters<typeof ReaderActionBar>[0]

function isElement(node: unknown): node is Element {
  return typeof node === 'object' && node !== null && 'props' in node
}

const composed: unknown[] = [Button, Icon, KeyboardHint]

// Renders the bar's own inner components and keeps the composed atoms.
function expand(node: Element): Element {
  return typeof node.type === 'function' && !composed.includes(node.type)
    ? expand((node.type as (props: unknown) => Element)(node.props))
    : node
}

function descendants(element: Element): Element[] {
  // Mapped actions arrive as a nested array, so flatten fully.
  return [element.props['children'] as ReactNode]
    .flat(Infinity)
    .filter(isElement)
    .map(expand)
    .flatMap((child) => [child, ...descendants(child)])
}

function render(props: Props) {
  const root = ReaderActionBar(props) as Element
  const all = descendants(root)
  const buttons = all.filter((element) => element.type === Button)
  const inside = (button: Element | undefined, type: unknown) =>
    button ? descendants(button).find((element) => element.type === type) : undefined
  const byClass = (className: string) =>
    all.find((element) => element.props['className'] === className)
  return { root, buttons, inside, byClass }
}

const archive = { label: 'Archive', icon: 'check', shortcut: 'E', onClick: vi.fn() } as const

describe('ReaderActionBar', () => {
  it('renders nothing without actions or a note', () => {
    expect(ReaderActionBar({})).toBeNull()
    expect(ReaderActionBar({ actions: [] })).toBeNull()
  })

  it('renders the primary action first, then the others as secondary by default', () => {
    const { root, buttons } = render({
      primaryAction: archive,
      actions: [
        { label: 'Reply', onClick: vi.fn() },
        { label: 'Snooze', variant: 'quiet', onClick: vi.fn() },
      ],
      className: 'extra',
    })
    expect(root.props['className']).toBe('reader-action-bar extra')
    expect(buttons.map((button) => button.props['variant'])).toEqual([
      'primary',
      'secondary',
      'quiet',
    ])
    for (const button of buttons) {
      expect(button.props['className']).toBe('reader-action-bar__action')
      expect(button.props).not.toHaveProperty('aria-label')
    }
  })

  it('leaves the action to the caller', () => {
    const onClick = vi.fn()
    const [button] = render({ primaryAction: { ...archive, onClick } }).buttons
    expect(onClick).not.toHaveBeenCalled()
    ;(button?.props['onClick'] as () => void)()
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('shows the label, a decorative icon and a hidden shortcut hint', () => {
    const { buttons, inside } = render({ primaryAction: archive })
    const [button] = buttons
    expect(button?.props['aria-keyshortcuts']).toBe('E')
    expect(inside(button, Icon)?.props).toEqual({ name: 'check' })
    expect(inside(button, 'span')?.props).toMatchObject({
      className: 'reader-action-bar__label',
      children: 'Archive',
    })
    const hint = inside(button, KeyboardHint)
    expect(hint?.props['children']).toBe('E')
    const wrapper = buttons
      .flatMap(descendants)
      .find((element) => element.props['className'] === 'reader-action-bar__hint')
    expect(wrapper?.props['aria-hidden']).toBe('true')
  })

  it('leaves out the icon and the shortcut when not given', () => {
    const { buttons, inside } = render({ actions: [{ label: 'Reply', onClick: vi.fn() }] })
    const [button] = buttons
    expect(button?.props['aria-keyshortcuts']).toBeUndefined()
    expect(inside(button, Icon)).toBeUndefined()
    expect(inside(button, KeyboardHint)).toBeUndefined()
  })

  it('disables an action and drops its shortcut, which would not work', () => {
    const { buttons, inside } = render({ primaryAction: { ...archive, disabled: true } })
    const [button] = buttons
    expect(button?.props['disabled']).toBe(true)
    expect(button?.props['aria-keyshortcuts']).toBeUndefined()
    expect(inside(button, KeyboardHint)).toBeUndefined()
  })

  it('shows a note with a title and an optional detail', () => {
    const withDetail = render({
      note: { title: 'Local status', detail: 'Mailbox unchanged.' },
    }).byClass('reader-action-bar__note')
    expect(withDetail?.type).toBe('p')
    const [title, detail] = withDetail?.props['children'] as [Element, Element]
    expect(title.props['children']).toBe('Local status')
    expect(detail.props['children']).toEqual([' ', 'Mailbox unchanged.'])

    const titleOnly = render({ note: { title: 'Local status' } }).byClass('reader-action-bar__note')
    expect((titleOnly?.props['children'] as unknown[])[1]).toBeUndefined()
  })
})
