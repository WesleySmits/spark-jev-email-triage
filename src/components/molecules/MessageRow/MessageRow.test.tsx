import type * as React from 'react'
import type { ChangeEvent, ReactElement, ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { AccountMarker } from '../../atoms/AccountMarker/AccountMarker'
import { Badge } from '../../atoms/Badge/Badge'
import { Checkbox } from '../../atoms/Checkbox/Checkbox'
import { MessageRow } from './MessageRow'

// MessageRow calls only useId. Replacing it lets the test call the component as
// a plain function and read the elements that reach the DOM. Mouse, keyboard,
// focus and layout are checked in Storybook.
let nextId = 0
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof React>()),
  useId: () => `id${String(nextId++)}`,
}))

type Element = ReactElement<Record<string, unknown>>
type Props = Parameters<typeof MessageRow>[0]

function isElement(node: unknown): node is Element {
  return typeof node === 'object' && node !== null && 'props' in node
}

function children(element: Element): Element[] {
  return ([] as ReactNode[]).concat(element.props['children'] as ReactNode).filter(isElement)
}

/** Every element below `element`, depth first, without calling child components. */
function descendants(element: Element): Element[] {
  return children(element).flatMap((child) => [child, ...descendants(child)])
}

/** The concatenated text of the elements an ARIA id list points at. */
function textOf(all: Element[], idList: unknown) {
  return String(idList)
    .split(' ')
    .map((id) => {
      const element = all.find((candidate) => candidate.props['id'] === id)
      if (!element) throw new Error(`No element with id ${id}`)
      return text(element)
    })
    .join(' | ')
}

function text(element: Element): string {
  const own = element.props['children']
  if (typeof own === 'string') return own
  return descendants(element)
    .map((child) => child.props['children'])
    .filter((value): value is string => typeof value === 'string')
    .join(' ')
}

function render(props: Partial<Props> = {}) {
  const root = MessageRow({ ...base, ...props }) as Element
  const [check, button] = root.props['children'] as [Element | undefined, Element]
  // The button holds one internal text component; render it to reach the DOM.
  const text = button.props['children'] as Element
  const content = (text.type as (props: unknown) => Element)(text.props)
  return { root, check, button, all: [content, ...descendants(content)] }
}

function byClass(all: Element[], className: string) {
  return all.filter((element) => String(element.props['className']).split(' ').includes(className))
}

const base: Props = {
  sender: 'Marit Vos',
  time: '09:42',
  dateTime: '2026-09-21T09:42',
  subject: 'Can delivery move a week earlier?',
  snippet: 'After our meeting I looked at the planning…',
  account: { marker: 'studio', label: 'Studio Noord' },
  status: { label: 'Needs review', tone: 'review' },
  category: 'Customer question',
  onActivate: () => undefined,
}

describe('MessageRow', () => {
  it('renders a div with a native button and no checkbox by default', () => {
    const { root, check, button, all } = render()
    expect(root.type).toBe('div')
    expect(root.props['className']).toBe('message-row')
    expect(check).toBeFalsy()
    expect(button.type).toBe('button')
    expect(button.props['type']).toBe('button')
    expect(all.some((element) => ['button', 'input', 'a'].includes(String(element.type)))).toBe(
      false,
    )
  })

  it('adds a reason line under the snippet and describes the button with it', () => {
    const reason = "Personal, decided by a person; priority Low, the model's."
    const { button, all } = render({ reason })
    expect(byClass(all, 'message-row__reason').map(text)).toEqual([reason])
    expect(textOf(all, button.props['aria-describedby'])).toBe(
      `Needs review Customer question | Studio Noord | 09:42 | After our meeting I looked at the planning… | ${reason}`,
    )
    expect(byClass(render().all, 'message-row__reason')).toHaveLength(0)
  })

  it('puts the checkbox beside the button, never inside it', () => {
    const { check, button, all } = render({
      selection: { label: 'Select Invoice March', checked: false, onChange: vi.fn() },
    })
    expect(check?.type).toBe(Checkbox)
    expect(check?.props).toMatchObject({ label: 'Select Invoice March', hideLabel: true })
    expect(button.type).toBe('button')
    expect(all.some((element) => element.type === Checkbox)).toBe(false)
  })

  it('names the button by sender and subject and describes it with the rest', () => {
    const { button, all } = render()
    expect(textOf(all, button.props['aria-labelledby'])).toBe(
      'Marit Vos | Can delivery move a week earlier?',
    )
    expect(textOf(all, button.props['aria-describedby'])).toBe(
      'Needs review Customer question | Studio Noord | 09:42 | After our meeting I looked at the planning…',
    )
  })

  it('shows sender, time, subject, snippet, account and badges', () => {
    const { all } = render()
    const time = all.find((element) => element.type === 'time')
    expect(time?.props).toMatchObject({ dateTime: '2026-09-21T09:42', children: '09:42' })
    expect(all.find((element) => element.type === AccountMarker)?.props).toEqual({
      account: 'studio',
    })
    const badges = all.filter((element) => element.type === Badge)
    expect(badges.map((badge) => badge.props)).toEqual([
      { tone: 'review', children: 'Needs review' },
      { children: 'Customer question' },
    ])
  })

  it('leaves the category badge out when there is none', () => {
    const { button, all } = render({ category: undefined })
    expect(all.filter((element) => element.type === Badge)).toHaveLength(1)
    expect(textOf(all, button.props['aria-describedby'])).toMatch(/^Needs review \|/)
  })

  it('marks unread rows in the class and the accessible name', () => {
    const { root, button, all } = render({ unread: true })
    expect(root.props['className']).toBe('message-row message-row--unread')
    expect(textOf(all, button.props['aria-labelledby'])).toBe(
      'Unread | Marit Vos | Can delivery move a week earlier?',
    )
    const localized = render({ unread: true, unreadLabel: 'Ongelezen' })
    expect(textOf(localized.all, localized.button.props['aria-labelledby'])).toMatch(
      /^Ongelezen \|/,
    )
  })

  it('exposes the selected row with aria-current and a class, not color alone', () => {
    const selected = render({ selected: true, className: 'extra' })
    expect(selected.root.props['className']).toBe('message-row message-row--selected extra')
    expect(selected.button.props['aria-current']).toBe('true')
    expect(render().button.props['aria-current']).toBeUndefined()
  })

  it('passes checked and disabled to the checkbox', () => {
    const { root, check } = render({
      selection: { label: 'Select', checked: true, disabled: true, onChange: vi.fn() },
    })
    expect(root.props['className']).toBe('message-row message-row--selectable')
    expect(check?.props).toMatchObject({ checked: true, disabled: true })
  })

  it('keeps activation and selection as separate callbacks', () => {
    const onActivate = vi.fn()
    const onChange = vi.fn()
    const { check, button } = render({
      onActivate,
      selection: { label: 'Select', checked: false, onChange },
    })
    const event = { currentTarget: { checked: true } } as ChangeEvent<HTMLInputElement>
    ;(check?.props['onChange'] as (event: unknown) => void)(event)
    expect(onChange).toHaveBeenCalledExactlyOnceWith(true)
    expect(onActivate).not.toHaveBeenCalled()
    ;(button.props['onClick'] as () => void)()
    expect(onActivate).toHaveBeenCalledOnce()
    expect(onChange).toHaveBeenCalledOnce()
  })

  it('marks sender, subject, snippet and account name for truncation', () => {
    const { all } = render()
    expect(
      byClass(all, 'message-row__truncate').map((element) => element.props['children']),
    ).toEqual([
      'Marit Vos',
      'Can delivery move a week earlier?',
      'After our meeting I looked at the planning…',
      'Studio Noord',
    ])
    expect(byClass(all, 'message-row__time')).toHaveLength(1)
    expect(byClass(all, 'message-row__time')[0]?.props['className']).not.toContain('truncate')
  })
})
