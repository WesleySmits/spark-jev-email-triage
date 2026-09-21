import type * as React from 'react'
import type { ReactElement, ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { Button } from '../../atoms/Button/Button'
import { Icon } from '../../atoms/Icon/Icon'
import { CategoryOption } from '../../molecules/CategoryOption/CategoryOption'
import { ReviewPanel } from './ReviewPanel'

// ReviewPanel calls only useId. Replacing it lets the test call the component
// as a plain function and walk the elements it returns. Keyboard, focus and
// rendering are checked in Storybook.
let nextId = 0
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof React>()),
  useId: () => `id${String(nextId++)}`,
}))

type Element = ReactElement<Record<string, unknown>>
type Props = Parameters<typeof ReviewPanel<string>>[0]

// Components from other folders stay as elements; the panel's own helpers expand.
const leaves = new Set<unknown>([Button, Icon, CategoryOption])

function flatten(node: ReactNode): Element[] {
  if (Array.isArray(node)) return node.flatMap((child: ReactNode) => flatten(child))
  if (!node || typeof node !== 'object' || !('props' in node)) return []
  const element = node as Element
  if (typeof element.type === 'function' && !leaves.has(element.type)) {
    const component = element.type as (props: unknown) => ReactNode
    return flatten(component(element.props))
  }
  return [element, ...flatten(element.props['children'] as ReactNode)]
}

function first(elements: Element[]): Element {
  const [element] = elements
  if (!element) throw new Error('No matching element')
  return element
}

const base: Props = {
  title: 'Needs review',
  summary: "The content and category don't match.",
  expanded: true,
  onExpandedChange: vi.fn(),
  scoreLabel: 'Model score',
  score: 57.6,
  reasonTitle: 'Why review?',
  reason: 'The sender asks for a decision.',
  originalLabel: 'Original AI suggestion',
  originalSuggestion: 'Newsletter',
  categoriesTitle: 'Choose the right category',
  categoriesHint: 'This does not complete the message.',
  categories: [
    { value: 'question', label: 'Customer question' },
    { value: 'newsletter', label: 'Newsletter' },
    { value: 'personal', label: 'Personal', disabled: true },
  ],
  selectedCategory: null,
  onSelectedCategoryChange: vi.fn(),
  saveLabel: 'Save review',
  onSave: vi.fn(),
}

function render(overrides: Partial<Props> = {}) {
  const props = { ...base, ...overrides }
  const elements = flatten(ReviewPanel(props))
  const find = (predicate: (element: Element) => boolean) => elements.filter(predicate)
  const byId = (id: unknown) => first(find((element) => element.props['id'] === id))
  const one = (type: unknown) => first(find((element) => element.type === type))
  const text = (type: string) => find((e) => e.type === type).map((e) => e.props['children'])
  return {
    props,
    find,
    byId,
    one,
    text,
    section: one('section'),
    toggle: one('button'),
    content: find((element) => element.props['className'] === 'review-panel__content')[0],
    group: first(find((element) => element.props['role'] === 'radiogroup')),
    options: find((element) => element.type === CategoryOption),
    save: one(Button),
  }
}

describe('ReviewPanel', () => {
  it('is a region named by its title, with a disclosure button in a heading', () => {
    const { section, toggle, byId, one } = render()
    expect(one('h2').props['children']).toBe(toggle)
    expect(byId(section.props['aria-labelledby']).props['children']).toBe('Needs review')
    expect(toggle.props).toMatchObject({ type: 'button', 'aria-expanded': true })
    expect(toggle.props['aria-labelledby']).toBe(section.props['aria-labelledby'])
    expect(byId(toggle.props['aria-describedby']).props['children']).toBe(base.summary)
  })

  it('controls the content and hides it while collapsed', () => {
    for (const expanded of [true, false]) {
      const { toggle, content } = render({ expanded })
      expect(toggle.props['aria-expanded']).toBe(expanded)
      expect(toggle.props['aria-controls']).toBe(content?.props['id'])
      expect(content?.props['hidden']).toBe(!expanded)
    }
  })

  it('asks the caller for the opposite expanded state', () => {
    const onExpandedChange = vi.fn()
    for (const expanded of [true, false]) {
      ;(render({ expanded, onExpandedChange }).toggle.props['onClick'] as () => void)()
    }
    expect(onExpandedChange.mock.calls).toEqual([[false], [true]])
  })

  it('names the radiogroup by its heading and describes it by the hint', () => {
    const { group, byId } = render()
    const heading = byId(group.props['aria-labelledby'])
    expect(heading.type).toBe('h3')
    expect(heading.props['children']).toBe('Choose the right category')
    expect(byId(group.props['aria-describedby']).props['children']).toBe(base.categoriesHint)
    expect(render({ categoriesHint: undefined }).group.props['aria-describedby']).toBeUndefined()
  })

  it('shifts every heading with headingLevel', () => {
    const { find } = render({ headingLevel: 4 })
    expect(find((element) => element.type === 'h4')).toHaveLength(1)
    expect(find((element) => element.type === 'h5')).toHaveLength(2)
  })

  it('renders one grouped option per category, checking the selected one', () => {
    const { options } = render({ selectedCategory: 'newsletter' })
    expect(options.map((option) => option.props['label'])).toEqual([
      'Customer question',
      'Newsletter',
      'Personal',
    ])
    expect(new Set(options.map((option) => option.props['name'])).size).toBe(1)
    expect(options.map((option) => option.props['checked'])).toEqual([false, true, false])
    expect(options[2]?.props['disabled']).toBe(true)
  })

  it('keeps the original suggestion visible whatever is selected or saved', () => {
    for (const overrides of [{}, { selectedCategory: 'question', result: { title: 'Saved' } }]) {
      const { text } = render(overrides)
      expect(text('dt')).toEqual(['Original AI suggestion'])
      expect(text('dd')).toEqual(['Newsletter'])
    }
  })

  it('shows the score rounded and bounded to 100', () => {
    const score = (value: number) => render({ score: value }).one('p').props['children']
    expect(score(57.6)).toEqual([expect.anything(), 'Model score', ' · ', '58/100'])
    expect((score(140) as unknown[])[3]).toBe('100/100')
    expect((score(-3) as unknown[])[3]).toBe('0/100')
  })

  it('reports the chosen category value to the caller', () => {
    const onSelectedCategoryChange = vi.fn()
    const { options } = render({ onSelectedCategoryChange })
    ;(options[0]?.props['onChange'] as () => void)()
    expect(onSelectedCategoryChange).toHaveBeenCalledWith('question')
  })

  it('saves through the caller once a category is selected', () => {
    const onSave = vi.fn()
    const { save } = render({ onSave, selectedCategory: 'question' })
    expect(save.props['disabled']).toBe(false)
    expect(save.props['onClick']).toBe(onSave)
  })

  it('disables save without a selection or when the caller asks', () => {
    expect(render().save.props['disabled']).toBe(true)
    expect(
      render({ selectedCategory: 'question', saveDisabled: true }).save.props['disabled'],
    ).toBe(true)
  })

  it('shows caller result copy without a live region of its own', () => {
    const { find, text } = render({ result: { title: 'Saved', detail: 'Original stays.' } })
    expect(text('strong')).toEqual(['Saved'])
    expect(text('span')).toContain('Original stays.')
    const live = find((element) => 'aria-live' in element.props || 'role' in element.props)
    expect(live.map((element) => element.props['role'])).toEqual(['radiogroup'])
    expect(render({ result: undefined }).text('strong')).toEqual([])
  })
})
