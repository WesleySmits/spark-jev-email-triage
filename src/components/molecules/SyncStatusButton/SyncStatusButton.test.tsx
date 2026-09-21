import type { ReactElement } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { Button } from '../../atoms/Button/Button'
import { StatusDot } from '../../atoms/StatusDot/StatusDot'
import { SyncStatusButton } from './SyncStatusButton'

type Element = ReactElement<Record<string, unknown>>

// SyncStatusButton is a plain function of its props, so the returned element
// shows what it composes. Focus, hover, wrapping and contrast are checked in
// Storybook.
function render(props: Parameters<typeof SyncStatusButton>[0]) {
  const root = SyncStatusButton(props) as Element
  const [dot, text] = root.props['children'] as [Element, Element]
  return { root, dot, text }
}

describe('SyncStatusButton', () => {
  it('is a quiet Button with a decorative dot and the visible status as its name', () => {
    const { root, dot, text } = render({ children: 'Updated 2 min ago' })
    expect(root.type).toBe(Button)
    expect(root.props).toMatchObject({
      variant: 'quiet',
      className: 'sync-status-button sync-status-button--connected',
    })
    expect(root.props).not.toHaveProperty('aria-label')
    expect(dot.type).toBe(StatusDot)
    expect(dot.props).toEqual({ tone: 'success' })
    expect(text).toMatchObject({
      type: 'span',
      props: { className: 'sync-status-button__text', children: 'Updated 2 min ago' },
    })
  })

  it('shows the disconnected state with the danger dot', () => {
    const { root, dot } = render({
      status: 'disconnected',
      children: 'Disconnected · last sync 10:14',
    })
    expect(root.props['className']).toBe('sync-status-button sync-status-button--disconnected')
    expect(dot.props).toEqual({ tone: 'danger' })
  })

  it('leaves behavior to the caller', () => {
    const onClick = vi.fn()
    const { root } = render({
      children: 'Updated 2 min ago',
      onClick,
      disabled: true,
      'aria-pressed': false,
      className: 'extra',
    })
    expect(root.props).toMatchObject({
      onClick,
      disabled: true,
      'aria-pressed': false,
      className: 'sync-status-button sync-status-button--connected extra',
    })
    expect(root.props).not.toHaveProperty('status')
    expect(onClick).not.toHaveBeenCalled()
  })
})
