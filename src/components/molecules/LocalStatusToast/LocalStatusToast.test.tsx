import type { ReactElement, ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { Button } from '../../atoms/Button/Button'
import { Icon } from '../../atoms/Icon/Icon'
import { LocalStatusToast } from './LocalStatusToast'

// LocalStatusToast is a plain function of its props, so the returned tree shows
// what reaches the DOM. Announcements, focus, reflow and contrast are checked
// in Storybook.
type Element = ReactElement<Record<string, unknown>>
type Props = Parameters<typeof LocalStatusToast>[0]

function isElement(node: unknown): node is Element {
  return typeof node === 'object' && node !== null && 'props' in node
}

function children(element: Element): Element[] {
  return ([] as ReactNode[]).concat(element.props['children'] as ReactNode).filter(isElement)
}

function descendants(element: Element): Element[] {
  return children(element).flatMap((child) => [child, ...descendants(child)])
}

function render(props: Partial<Props> = {}) {
  const root = LocalStatusToast({
    visible: true,
    title: 'Handled locally',
    detail: 'Mailbox unchanged.',
    dismissLabel: 'Dismiss',
    onDismiss: vi.fn(),
    ...props,
  }) as Element
  const all = descendants(root)
  const status = all.find((element) => element.props['role'] === 'status')
  if (!status) throw new Error('No status region')
  const buttons = all.filter((element) => element.type === Button)
  return { root, all, status, buttons }
}

describe('LocalStatusToast', () => {
  it('announces the title and detail politely through a status region', () => {
    const { root, status, all } = render()
    expect(root.props['className']).toBe('local-status-toast local-status-toast--visible')
    expect(status.props).toMatchObject({ role: 'status', 'aria-live': 'polite' })
    expect(status.props).not.toHaveProperty('aria-label')
    const title = all.find((element) => element.type === 'strong')
    const detail = all.find(
      (element) => element.props['className'] === 'local-status-toast__detail',
    )
    expect(title?.props['children']).toBe('Handled locally')
    expect(detail?.props['children']).toBe('Mailbox unchanged.')
  })

  it('keeps the icon decorative and the actions out of the status region', () => {
    const { status, buttons } = render({ actionLabel: 'Undo', onAction: vi.fn() })
    const inside = descendants(status)
    const icon = inside.find((element) => element.type === Icon)
    expect(icon?.props).toEqual({ name: 'check' })
    expect(inside.some((element) => element.type === Button)).toBe(false)
    expect(buttons).toHaveLength(2)
  })

  it('leaves out an empty detail', () => {
    const { all } = render({ detail: undefined })
    expect(all.some((element) => element.type === 'span')).toBe(false)
  })

  it('keeps an empty status region while hidden, without actions or key handling', () => {
    const { root, status, buttons } = render({
      visible: false,
      actionLabel: 'Undo',
      onAction: vi.fn(),
    })
    expect(root.props['className']).toBe('local-status-toast')
    expect(root.props['onKeyDown']).toBeUndefined()
    expect(status.props['role']).toBe('status')
    expect(children(status)).toEqual([])
    expect(buttons).toEqual([])
  })

  it('shows the action only with both a label and a handler', () => {
    expect(render({ actionLabel: 'Undo' }).buttons).toHaveLength(1)
    expect(render({ onAction: vi.fn() }).buttons).toHaveLength(1)
  })

  it('wires the caller-owned actions to quiet text buttons', () => {
    const onAction = vi.fn()
    const onDismiss = vi.fn()
    const { buttons } = render({ actionLabel: 'Undo', onAction, onDismiss })
    const [undo, dismiss] = buttons as [Element, Element]
    for (const button of buttons) {
      expect(button.props).toMatchObject({
        variant: 'quiet',
        className: 'local-status-toast__action',
      })
    }
    expect(undo.props).toMatchObject({ children: 'Undo', onClick: onAction })
    expect(dismiss.props).toMatchObject({ children: 'Dismiss', onClick: onDismiss })
    expect(onAction).not.toHaveBeenCalled()
    expect(onDismiss).not.toHaveBeenCalled()
  })

  it('dismisses on Escape only', () => {
    const onDismiss = vi.fn()
    const { root } = render({ onDismiss })
    const onKeyDown = root.props['onKeyDown'] as (event: { key: string }) => void
    onKeyDown({ key: 'Enter' })
    expect(onDismiss).not.toHaveBeenCalled()
    onKeyDown({ key: 'Escape' })
    expect(onDismiss).toHaveBeenCalledOnce()
  })
})
