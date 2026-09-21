import type { ReactElement, ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { Button } from '../../atoms/Button/Button'
import { Icon } from '../../atoms/Icon/Icon'
import { DisconnectedState } from './DisconnectedState'

// DisconnectedState is a plain function of its props, so the returned tree
// shows what reaches the DOM. Announcements, focus, reflow and contrast are
// checked in Storybook.
type Element = ReactElement<Record<string, unknown>>
type Props = Parameters<typeof DisconnectedState>[0]

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
  const root = DisconnectedState({
    title: 'Spark is unavailable',
    children: 'Your local review is still available.',
    ...props,
  }) as Element
  const all = descendants(root)
  const byClass = (className: string) =>
    all.find((element) => String(element.props['className']).split(' ').includes(className))
  const message = byClass('disconnected-state__message')
  if (!message) throw new Error('No message')
  const buttons = all.filter((element) => element.type === Button)
  return { root, all, byClass, message, buttons }
}

describe('DisconnectedState', () => {
  it('renders the caller heading as an h2 by default, holding only the title', () => {
    const { root, byClass } = render({ className: 'queue-empty' })
    expect(root.props['className']).toBe('disconnected-state queue-empty')
    expect(byClass('disconnected-state__title')).toMatchObject({
      type: 'h2',
      props: { children: 'Spark is unavailable' },
    })
  })

  it('renders heading level 3', () => {
    expect(render({ headingLevel: 3 }).byClass('disconnected-state__title')?.type).toBe('h3')
  })

  it('announces the heading and recovery copy politely, never as an alert', () => {
    const { all, message, byClass } = render()
    expect(message.props).toMatchObject({ role: 'status', 'aria-live': 'polite' })
    expect(all.some((element) => element.props['role'] === 'alert')).toBe(false)
    const inside = descendants(message)
    expect(inside).toContain(byClass('disconnected-state__title'))
    expect(inside).toContain(byClass('disconnected-state__recovery'))
    expect(byClass('disconnected-state__recovery')?.props['children']).toBe(
      'Your local review is still available.',
    )
  })

  it('leaves out the live region when another region already announces the failure', () => {
    const { all } = render({ announce: false })
    expect(all.some((element) => 'role' in element.props || 'aria-live' in element.props)).toBe(
      false,
    )
  })

  it('keeps the icon decorative', () => {
    const icon = render().all.find((element) => element.type === Icon)
    expect(icon?.props).toEqual({ name: 'alert' })
  })

  it('keeps the last-known context and the action out of the status region', () => {
    const { message, byClass, buttons } = render({
      lastKnown: 'Showing local data from 10:14.',
      action: { label: 'Try again', onClick: vi.fn() },
    })
    const inside = descendants(message)
    expect(byClass('disconnected-state__last-known')).toMatchObject({
      type: 'p',
      props: { children: 'Showing local data from 10:14.' },
    })
    expect(inside).not.toContain(byClass('disconnected-state__last-known'))
    expect(inside.some((element) => element.type === Button)).toBe(false)
    expect(buttons).toHaveLength(1)
  })

  it('wires the caller-owned action to a secondary button without calling it', () => {
    const onClick = vi.fn()
    const [button] = render({ action: { label: 'Try again', onClick } }).buttons
    expect(button?.props).toMatchObject({
      variant: 'secondary',
      className: 'disconnected-state__action',
      onClick,
      children: 'Try again',
    })
    expect(onClick).not.toHaveBeenCalled()
  })

  it('leaves out the footer without context or action', () => {
    const { byClass, buttons } = render()
    expect(byClass('disconnected-state__footer')).toBeUndefined()
    expect(buttons).toEqual([])
  })
})
