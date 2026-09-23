import type * as React from 'react'
import type { ReactElement, ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { Badge } from '../../atoms/Badge/Badge'
import { ClassificationEvidence } from './ClassificationEvidence'

// ClassificationEvidence calls only useId. Replacing it lets the test call
// the component as a plain function and walk the elements it returns.
// Layout and wrapping are checked in Storybook.
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof React>()),
  useId: () => ':r1:',
}))

type Element = ReactElement<Record<string, unknown>>
type Props = Parameters<typeof ClassificationEvidence>[0]

function isElement(node: unknown): node is Element {
  return typeof node === 'object' && node !== null && 'props' in node
}

function descendants(element: Element): Element[] {
  return [element.props['children'] as ReactNode]
    .flat(Infinity)
    .filter(isElement)
    .flatMap((child) => [child, ...descendants(child)])
}

function render(props: Partial<Props> = {}) {
  const root = ClassificationEvidence({
    title: 'Jev triage',
    state: { label: 'Triage current', tone: 'done' },
    detail: 'Checked against the thread that was read for this message.',
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

const facts: Props['facts'] = [
  { term: 'Category', value: 'Personal' },
  { term: 'Priority', value: 'High', note: 'The model was not sure of this priority.' },
]

describe('ClassificationEvidence', () => {
  it('is a section named by its title, an h3 by default', () => {
    const { root, get } = render()
    expect(root.type).toBe('section')
    expect(root.props['aria-labelledby']).toBe(':r1:-title')
    expect(get('classification-evidence__title')).toMatchObject({
      type: 'h3',
      props: { id: ':r1:-title', children: 'Jev triage' },
    })
  })

  it.each([2, 3, 4] as const)('renders heading level %i', (headingLevel) => {
    expect(render({ headingLevel }).get('classification-evidence__title').type).toBe(
      `h${String(headingLevel)}`,
    )
  })

  it('always shows the state as words in a Badge, never as a color alone', () => {
    const badge = render({ state: { label: 'Triage failed', tone: 'danger' } }).all.find(
      (element) => element.type === Badge,
    )
    expect(badge?.props).toEqual({ tone: 'danger', children: 'Triage failed' })
  })

  it('shows the detail, and a note only when there is one', () => {
    const { get, byClass } = render({ detail: 'Nothing was judged.', note: 'Reported: timeout' })
    expect(get('classification-evidence__detail').props['children']).toBe('Nothing was judged.')
    expect(get('classification-evidence__note').props['children']).toBe('Reported: timeout')
    expect(render().byClass('classification-evidence__note')).toBeUndefined()
    expect(byClass('classification-evidence__facts')).toBeUndefined()
  })

  it('lists the facts as terms and values, each with its own note', () => {
    const { all, get } = render({ facts })
    expect(get('classification-evidence__facts').type).toBe('dl')
    const terms = all.filter((element) => element.type === 'dt')
    expect(terms.map((term) => term.props['children'])).toEqual(['Category', 'Priority'])
    const notes = all.filter(
      (element) => element.props['className'] === 'classification-evidence__fact-note',
    )
    expect(notes.map((note) => note.props['children'])).toEqual([
      'The model was not sure of this priority.',
    ])
  })

  it('shows when it was judged, with the machine-readable instant', () => {
    const judged = { label: 'Judged', text: '22 Sep, 09:15', dateTime: '2026-09-22T09:15:00.000Z' }
    const { get, all } = render({ judged })
    expect(get('classification-evidence__judged').props['children']).toContain('Judged')
    const time = all.find((element) => element.type === 'time')
    expect(time?.props).toMatchObject({ dateTime: judged.dateTime, children: judged.text })
    expect(render().byClass('classification-evidence__judged')).toBeUndefined()
  })

  it('offers no control and adds no live region: it only reports', () => {
    const { root, all } = render({ facts, note: 'Reported: timeout' })
    for (const element of [root, ...all]) {
      expect(String(element.type)).not.toMatch(/^(button|a|input|form|select)$/)
      expect(element.props).not.toHaveProperty('aria-live')
      expect(element.props).not.toHaveProperty('onClick')
    }
  })

  it('adds extra classes to the root', () => {
    expect(render({ className: 'extra' }).root.props['className']).toBe(
      'classification-evidence extra',
    )
  })
})
