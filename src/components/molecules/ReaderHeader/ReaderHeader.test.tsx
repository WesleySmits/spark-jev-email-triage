import type { ReactElement, ReactNode } from 'react'
import { describe, expect, it } from 'vitest'
import { Badge } from '../../atoms/Badge/Badge'
import { SenderMeta } from '../SenderMeta/SenderMeta'
import { ReaderHeader } from './ReaderHeader'

// ReaderHeader is a plain function of its props, so the returned tree shows
// what reaches the DOM. Layout, wrapping and reflow are checked in Storybook.
type Element = ReactElement<Record<string, unknown>>
type Props = Parameters<typeof ReaderHeader>[0]

function isElement(node: unknown): node is Element {
  return typeof node === 'object' && node !== null && 'props' in node
}

function descendants(element: Element): Element[] {
  return ([] as ReactNode[])
    .concat(element.props['children'] as ReactNode)
    .filter(isElement)
    .flatMap((child) => [child, ...descendants(child)])
}

const sender: Props['sender'] = {
  name: 'Marit Vos',
  initials: 'MV',
  address: 'marit.vos@example.com',
  account: { marker: 'studio', label: 'Studio Noord' },
  time: 'Today, 09:42',
  dateTime: '2026-09-21T09:42',
}

function render(props: Partial<Props> = {}) {
  const root = ReaderHeader({
    subject: 'Can delivery move a week earlier?',
    status: { tone: 'review', label: 'Needs review' },
    sender,
    ...props,
  }) as Element
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

describe('ReaderHeader', () => {
  it('renders the subject as an h2 by default, holding only the subject', () => {
    const { root, byClass } = render()
    expect(root.type).toBe('div')
    expect(root.props['className']).toBe('reader-header')
    expect(byClass('reader-header__subject')).toMatchObject({
      type: 'h2',
      props: { children: 'Can delivery move a week earlier?' },
    })
  })

  it.each([1, 2, 3, 4] as const)('renders heading level %i', (headingLevel) => {
    expect(render({ headingLevel }).byClass('reader-header__subject')?.type).toBe(
      `h${String(headingLevel)}`,
    )
  })

  it('puts the caller id on the heading so a reader can reference it', () => {
    expect(
      render({ subjectId: 'reader-subject' }).byClass('reader-header__subject')?.props['id'],
    ).toBe('reader-subject')
  })

  it('adds no landmark, live region or control of its own', () => {
    const { root, all } = render()
    for (const element of [root, ...all]) {
      expect(String(element.type)).not.toMatch(/^(header|section|article|button|a|input)$/)
      expect(element.props).not.toHaveProperty('role')
      expect(element.props).not.toHaveProperty('aria-live')
    }
  })

  it('shows the status as a Badge beside the heading, not inside it', () => {
    const { all, get } = render()
    const badge = all.find((element) => element.type === Badge)
    expect(badge?.props).toEqual({ tone: 'review', children: 'Needs review' })
    expect(descendants(get('reader-header__subject'))).toEqual([])
  })

  it('leaves out the status when not given', () => {
    const { all, byClass } = render({ status: undefined })
    expect(byClass('reader-header__status')).toBeUndefined()
    expect(all.some((element) => element.type === Badge)).toBe(false)
  })

  it('passes the sender to SenderMeta unchanged, after the title row', () => {
    const { root, all } = render({ sender: { ...sender, address: undefined, toLabel: 'naar' } })
    const meta = all.find((element) => element.type === SenderMeta)
    expect(meta?.props).toEqual({
      ...sender,
      address: undefined,
      toLabel: 'naar',
      className: 'reader-header__sender',
    })
    expect((root.props['children'] as Element[])[1]).toBe(meta)
  })

  it('adds extra classes to the root', () => {
    expect(render({ className: 'extra' }).root.props['className']).toBe('reader-header extra')
  })
})
