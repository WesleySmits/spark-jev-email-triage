import type { ReactElement, ReactNode } from 'react'
import { describe, expect, it } from 'vitest'
import { AccountMarker } from '../../atoms/AccountMarker/AccountMarker'
import { Avatar } from '../../atoms/Avatar/Avatar'
import { SenderMeta } from './SenderMeta'

// SenderMeta is a plain function of its props, so the returned tree shows what
// reaches the DOM. Layout, wrapping and reflow are checked in Storybook.
type Element = ReactElement<Record<string, unknown>>
type Props = Parameters<typeof SenderMeta>[0]

function isElement(node: unknown): node is Element {
  return typeof node === 'object' && node !== null && 'props' in node
}

function descendants(element: Element): Element[] {
  return ([] as ReactNode[])
    .concat(element.props['children'] as ReactNode)
    .filter(isElement)
    .flatMap((child) => [child, ...descendants(child)])
}

/** The text a screen reader gets: strings in order, skipping aria-hidden elements. */
function spoken(element: Element): string {
  if (element.props['aria-hidden']) return ''
  return ([] as ReactNode[])
    .concat(element.props['children'] as ReactNode)
    .map((child) => {
      if (typeof child === 'string') return child
      if (!isElement(child)) return ''
      return typeof child.type === 'function' ? '' : spoken(child)
    })
    .join('')
}

const base: Props = {
  name: 'Marit Vos',
  initials: 'MV',
  address: 'marit.vos@example.com',
  account: { marker: 'studio', label: 'Studio Noord' },
  time: 'Today, 09:42',
  dateTime: '2026-09-21T09:42',
}

function render(props: Partial<Props> = {}) {
  const root = SenderMeta({ ...base, ...props }) as Element
  const all = descendants(root)
  const byClass = (className: string) =>
    all.find((element) => String(element.props['className']).split(' ').includes(className))
  const get = (className: string) => {
    const element = byClass(className)
    if (!element) throw new Error(`No element with class ${className}`)
    return element
  }
  return { root, all, byClass, get }
}

describe('SenderMeta', () => {
  it('renders a div with no controls, headings or live regions', () => {
    const { root, all } = render()
    expect(root.type).toBe('div')
    expect(root.props['className']).toBe('sender-meta')
    for (const element of [root, ...all]) {
      expect(String(element.type)).not.toMatch(/^(button|a|input|h\d)$/)
      expect(element.props).not.toHaveProperty('role')
      expect(element.props).not.toHaveProperty('aria-live')
    }
  })

  it('adds extra classes to the root', () => {
    expect(render({ className: 'extra' }).root.props['className']).toBe('sender-meta extra')
  })

  it('shows a decorative avatar, because the name is visible beside it', () => {
    const avatar = render().all.find((element) => element.type === Avatar)
    expect(avatar?.props).toEqual({ initials: 'MV' })
  })

  it('shows the name, address and mailbox as given', () => {
    const { all, byClass, get } = render()
    expect(byClass('sender-meta__name')?.props['children']).toBe('Marit Vos')
    expect(byClass('sender-meta__address')?.props['children']).toBe('marit.vos@example.com')
    expect(all.find((element) => element.type === AccountMarker)?.props).toEqual({
      account: 'studio',
    })
    expect(spoken(get('sender-meta__account'))).toBe('Studio Noord')
  })

  it('reads a word instead of the visual arrow', () => {
    const { all, get } = render()
    const arrow = all.find((element) => element.props['children'] === '→')
    expect(arrow?.props['aria-hidden']).toBe(true)
    expect(spoken(get('sender-meta__context'))).toBe('marit.vos@example.com to Studio Noord')
    expect(spoken(render({ toLabel: 'naar' }).get('sender-meta__context'))).toBe(
      'marit.vos@example.com naar Studio Noord',
    )
  })

  it('shows only the mailbox without an address', () => {
    const { all, byClass, get } = render({ address: undefined })
    expect(byClass('sender-meta__address')).toBeUndefined()
    expect(byClass('sender-meta__hidden')).toBeUndefined()
    expect(all.some((element) => element.props['children'] === '→')).toBe(false)
    expect(spoken(get('sender-meta__context'))).toBe('Studio Noord')
  })

  it('shows the time in a time element', () => {
    const time = render().all.find((element) => element.type === 'time')
    expect(time?.props).toEqual({
      className: 'sender-meta__time',
      dateTime: '2026-09-21T09:42',
      children: 'Today, 09:42',
    })
  })

  it('reads name, context and time in visual order', () => {
    expect(spoken(render().root)).toBe('Marit Vosmarit.vos@example.com to Studio NoordToday, 09:42')
  })
})
