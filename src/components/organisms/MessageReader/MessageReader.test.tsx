import type * as React from 'react'
import type { ReactElement, ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { MobileReaderBar } from '../../molecules/MobileReaderBar/MobileReaderBar'
import { ReaderActionBar } from '../../molecules/ReaderActionBar/ReaderActionBar'
import { ReaderHeader } from '../../molecules/ReaderHeader/ReaderHeader'
import { MessageReader } from './MessageReader'

// MessageReader calls only useId. Replacing it lets the test call the
// component as a plain function and walk the elements it returns. The composed
// molecules stay as elements. Scrolling, focus and reflow are checked in
// Storybook.
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof React>()),
  useId: () => ':r1:',
}))

type Element = ReactElement<Record<string, unknown>>
type Props = Parameters<typeof MessageReader>[0]

function isElement(node: unknown): node is Element {
  return typeof node === 'object' && node !== null && 'props' in node
}

function descendants(element: Element): Element[] {
  return [element.props['children'] as ReactNode]
    .flat(Infinity)
    .filter(isElement)
    .flatMap((child) => [child, ...descendants(child)])
}

const header: Props['header'] = {
  subject: 'Can delivery move a week earlier?',
  status: { tone: 'review', label: 'Needs review' },
  sender: {
    name: 'Marit Vos',
    initials: 'MV',
    account: { marker: 'studio', label: 'Studio Noord' },
    time: 'Today, 09:42',
  },
}

function render(props: Partial<Props> = {}) {
  const root = MessageReader({ header, children: <p>Hi Wesley,</p>, ...props }) as Element
  const all = descendants(root)
  const one = (type: unknown) => all.find((element) => element.type === type)
  const byClass = (className: string) =>
    all.find((element) => String(element.props['className']).split(' ').includes(className))
  const get = (className: string) => {
    const element = byClass(className)
    if (!element) throw new Error(`No element with class ${className}`)
    return element
  }
  return { root, all, one, byClass, get }
}

describe('MessageReader', () => {
  it('is an article named by the header subject', () => {
    const { root, one } = render()
    expect(root.type).toBe('article')
    expect(root.props['className']).toBe('message-reader')
    expect(root.props['aria-labelledby']).toBe(':r1:-subject')
    expect(one(ReaderHeader)?.props).toEqual({ ...header, subjectId: ':r1:-subject' })
  })

  it('orders the bar, header, content and footer as in the source', () => {
    const actions = { primaryAction: { label: 'Archive', onClick: vi.fn() } }
    const onBack = vi.fn()
    const { root } = render({ mobileBar: { title: 'Studio Noord', onBack }, actions })
    const children = (root.props['children'] as unknown[]).filter(isElement)
    expect(children.map((child) => child.type)).toEqual([
      MobileReaderBar,
      ReaderHeader,
      'div',
      ReaderActionBar,
    ])
    expect(children[0]?.props).toEqual({
      title: 'Studio Noord',
      onBack,
      className: 'message-reader__mobile-bar',
    })
    expect(children[3]?.props).toEqual(actions)
  })

  it('makes the content a named, focusable region', () => {
    expect(render().get('message-reader__scroll').props).toMatchObject({
      role: 'region',
      'aria-label': 'Message content',
      tabIndex: 0,
    })
    expect(
      render({ contentLabel: 'Berichtinhoud' }).get('message-reader__scroll').props['aria-label'],
    ).toBe('Berichtinhoud')
  })

  it('renders the body and the review inside the scroll region, in that order', () => {
    const review = <section>Review</section>
    const { get } = render({ review })
    const scroll = descendants(get('message-reader__scroll'))
    expect(scroll.map((element) => element.props['className'] ?? element.type)).toEqual([
      'message-reader__body',
      'p',
      'message-reader__review',
      'section',
    ])
    expect(get('message-reader__review').props['children']).toBe(review)
  })

  it('leaves out the bar, review and footer when not given', () => {
    const { one, byClass } = render()
    expect(one(MobileReaderBar)).toBeUndefined()
    expect(one(ReaderActionBar)).toBeUndefined()
    expect(byClass('message-reader__review')).toBeUndefined()
  })

  it('renders hostile-looking body text as text, never as HTML', () => {
    const text = '<img src="https://tracker.example/p.gif" onerror="alert(1)"><script>x()</script>'
    const { all, get } = render({ children: text })
    expect(get('message-reader__body').props['children']).toBe(text)
    for (const element of all) {
      expect(element.props).not.toHaveProperty('dangerouslySetInnerHTML')
      expect(String(element.type)).not.toMatch(/^(img|script|iframe|link|style)$/)
    }
  })

  it('adds no live region; the caller announces results', () => {
    const { root, all } = render({ review: <p>Review</p> })
    for (const element of [root, ...all]) {
      expect(element.props).not.toHaveProperty('aria-live')
      expect(element.props['role']).not.toBe('status')
    }
  })

  it('adds extra classes to the root', () => {
    expect(render({ className: 'extra' }).root.props['className']).toBe('message-reader extra')
  })
})
