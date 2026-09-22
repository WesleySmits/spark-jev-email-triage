import type { ReactElement, ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { Button } from '../../atoms/Button/Button'
import { Icon } from '../../atoms/Icon/Icon'
import { StatusDot } from '../../atoms/StatusDot/StatusDot'
import { ConnectionPanel } from './ConnectionPanel'

// ConnectionPanel is a plain function of its props, so the returned tree
// shows what reaches the DOM. Its own parts are expanded; atoms are not.
// Announcements, focus, reflow, motion and contrast are checked in Storybook.
type Element = ReactElement<Record<string, unknown>>
type Props = Parameters<typeof ConnectionPanel>[0]
type Part = (props: Record<string, unknown>) => ReactNode

const atoms: readonly unknown[] = [Button, Icon, StatusDot]

function isElement(node: unknown): node is Element {
  return typeof node === 'object' && node !== null && 'props' in node
}

/** An element, with the panel's own function parts rendered in place. */
function expand(node: Element): Element[] {
  if (typeof node.type === 'function' && !atoms.includes(node.type)) {
    const rendered = (node.type as Part)(node.props)
    return isElement(rendered) ? expand(rendered) : []
  }
  return [node]
}

function descendants(element: Element): Element[] {
  return ([] as ReactNode[])
    .concat(element.props['children'] as ReactNode)
    .flat()
    .filter(isElement)
    .flatMap(expand)
    .flatMap((child) => [child, ...descendants(child)])
}

function render(props: Partial<Props> = {}) {
  const root = ConnectionPanel({ tone: 'waiting', title: 'Waiting for Spark', ...props }) as Element
  const all = descendants(root)
  const byClass = (className: string) =>
    all.find((element) => String(element.props['className']).split(' ').includes(className))
  const text = (element: Element | undefined): string =>
    element
      ? ([] as ReactNode[])
          .concat(element.props['children'] as ReactNode)
          .flat()
          .map((child) => (isElement(child) ? text(child) : typeof child === 'string' ? child : ''))
          .join('')
      : ''
  const button = all.find((element) => element.type === Button)
  return { root, all, byClass, text, button }
}

describe('ConnectionPanel', () => {
  it('puts only the dot and the heading, an h2 by default, in a polite status region', () => {
    const { byClass, text } = render({
      meta: 'Last checked 09:41:08',
      action: { label: 'Check now', onClick: vi.fn() },
    })
    const status = byClass('connection-panel__status')
    expect(status?.props).toMatchObject({ role: 'status', 'aria-live': 'polite' })
    const [dot, heading] = status?.props['children'] as [Element, Element]
    expect(dot.type).toBe(StatusDot)
    expect(heading.type).toBe('h2')
    expect(text(status)).toBe('Waiting for Spark')
  })

  it('numbers the steps in an ordered list', () => {
    const { byClass } = render({
      steps: ['Open Spark on this Mac.', 'Check that you are signed in.'],
    })
    const list = byClass('connection-panel__steps')
    expect(list?.type).toBe('ol')
    expect((list?.props['children'] as Element[]).map((item) => item.props['children'])).toEqual([
      'Open Spark on this Mac.',
      'Check that you are signed in.',
    ])
  })

  it('offers the action as a secondary button that runs on click', () => {
    const onClick = vi.fn()
    const { button } = render({ action: { label: 'Check now', onClick } })
    expect(button?.props).toMatchObject({
      variant: 'secondary',
      className: 'connection-panel__action',
      onClick,
    })
    expect(button?.props['aria-disabled']).toBeUndefined()
  })

  it('keeps a busy action in place, aria-disabled and without a click handler', () => {
    const { button, byClass } = render({
      action: { label: 'Checking…', busy: true, onClick: vi.fn() },
    })
    expect(button?.props['aria-disabled']).toBe(true)
    expect(button?.props['disabled']).toBeUndefined()
    expect(button?.props['onClick']).toBeUndefined()
    expect(byClass('connection-panel__spin')).toBeDefined()
  })

  it('leaves out the footer without meta, hint or action', () => {
    expect(render().byClass('connection-panel__footer')).toBeUndefined()
  })

  it('shows a hint under the meta line, outside the status region', () => {
    const { byClass, text } = render({
      meta: 'Still waiting.',
      hint: 'Quit Spark and open it again.',
    })
    expect(text(byClass('connection-panel__meta'))).toBe(
      'Still waiting.Quit Spark and open it again.',
    )
    expect(text(byClass('connection-panel__status'))).not.toContain('Still waiting')
  })

  it('uses no danger tone or alert icon', () => {
    const { all } = render({ tone: 'neutral', note: 'Read only.' })
    expect(all.find((element) => element.type === StatusDot)?.props['tone']).toBe('neutral')
    expect(all.some((element) => element.props['name'] === 'alert')).toBe(false)
  })
})
