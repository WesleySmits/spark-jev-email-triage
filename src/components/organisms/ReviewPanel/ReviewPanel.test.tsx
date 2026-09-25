import type * as React from 'react'
import type { ReactElement, ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { Button } from '../../atoms/Button/Button'
import { Icon } from '../../atoms/Icon/Icon'
import { CategoryOption } from '../../molecules/CategoryOption/CategoryOption'
import { ReviewPanel, type ReviewField } from './ReviewPanel'

// ReviewPanel calls only useId. Replacing it lets the test call the component
// as a plain function and walk the elements it returns. Keyboard, focus and
// rendering are checked in Storybook.
let nextId = 0
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof React>()),
  useId: () => `id${String(nextId++)}`,
}))

type Element = ReactElement<Record<string, unknown>>
type Props = Parameters<typeof ReviewPanel>[0]

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

const category: ReviewField = {
  name: 'category',
  label: 'Category',
  advice: 'Newsletter',
  options: [
    { value: 'question', label: 'Customer question' },
    { value: 'newsletter', label: 'Newsletter', note: "The model's advice" },
    { value: 'personal', label: 'Personal', disabled: true },
  ],
  chosen: null,
  onChoose: vi.fn(),
  state: { label: 'Not reviewed', tone: 'none' },
  decidedBy: 'Nobody. The model decided this.',
  undoLabel: 'Undo',
}

const priority: ReviewField = {
  name: 'priority',
  label: 'Priority',
  advice: 'High',
  adviceNote: 'The model was not sure of this.',
  options: [
    { value: 'high', label: 'High', note: "The model's advice" },
    { value: 'normal', label: 'Normal' },
  ],
  chosen: 'normal',
  onChoose: vi.fn(),
  state: { label: 'Changing to Normal. Not saved yet.', tone: 'pending' },
  decidedBy: 'Nobody. The model decided this.',
  undoLabel: 'Undo',
  onUndo: vi.fn(),
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
  keptNote: "The model's advice is kept whatever you decide.",
  fieldsTitle: "The model's advice and your decision",
  fieldsHint: 'This does not complete the message.',
  cells: { advice: 'Model advises', decision: 'Your decision', decidedBy: 'Decided by' },
  fields: [category, priority],
  saveLabel: 'Save 1 field',
  onSave: vi.fn(),
}

function render(overrides: Partial<Props> = {}) {
  const props = { ...base, ...overrides }
  const elements = flatten(ReviewPanel(props))
  const find = (predicate: (element: Element) => boolean) => elements.filter(predicate)
  const byId = (id: unknown) => first(find((element) => element.props['id'] === id))
  const one = (type: unknown) => first(find((element) => element.type === type))
  const text = (type: string) => find((e) => e.type === type).map((e) => e.props['children'])
  const className = (name: string) => find((e) => e.props['className'] === name)
  return {
    props,
    find,
    byId,
    one,
    text,
    className,
    section: one('section'),
    toggle: one('button'),
    content: className('review-panel__content')[0],
    groups: find((element) => element.props['role'] === 'radiogroup'),
    options: find((element) => element.type === CategoryOption),
    buttons: find((element) => element.type === Button),
    save: first(find((element) => element.props['className'] === 'review-panel__save')),
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

  it('names the fields by their heading and describes them by the hint', () => {
    const { className, byId } = render()
    const fields = first(className('review-panel__fields'))
    const heading = byId(fields.props['aria-labelledby'])
    expect(heading.type).toBe('h3')
    expect(heading.props['children']).toBe(base.fieldsTitle)
    expect(byId(fields.props['aria-describedby']).props['children']).toBe(base.fieldsHint)
    expect(
      first(render({ fieldsHint: undefined }).className('review-panel__fields')).props[
        'aria-describedby'
      ],
    ).toBeUndefined()
  })

  it('shifts every heading with headingLevel', () => {
    const { find } = render({ headingLevel: 4 })
    expect(find((element) => element.type === 'h4')).toHaveLength(1)
    expect(find((element) => element.type === 'h5')).toHaveLength(2)
  })

  // One group per field, each named by that field and by the decision cell, so
  // a person hears which field a group of options belongs to.
  it('gives each field its own radiogroup, named by the field and the cell', () => {
    const { groups, byId } = render()
    expect(groups).toHaveLength(2)
    const named = groups.map((group) =>
      String(group.props['aria-labelledby'])
        .split(' ')
        .map((id) => byId(id).props['children']),
    )
    expect(named).toEqual([
      ['Category', 'Your decision'],
      ['Priority', 'Your decision'],
    ])
  })

  it('renders one grouped option per value, checking the chosen one', () => {
    const { options } = render()
    const ours = options.filter((option) => option.props['name'] === options[0]?.props['name'])
    expect(ours.map((option) => option.props['label'])).toEqual([
      'Customer question',
      'Newsletter',
      'Personal',
    ])
    expect(ours.map((option) => option.props['checked'])).toEqual([false, false, false])
    expect(ours[1]?.props['description']).toBe("The model's advice")
    expect(ours[2]?.props['disabled']).toBe(true)
    // Two fields, two groups: one field's options never join another's.
    expect(new Set(options.map((option) => option.props['name'])).size).toBe(2)
  })

  it('checks the chosen value of a field that holds one', () => {
    const { options } = render()
    const theirs = options.filter((option) => option.props['value'] === 'normal')
    expect(theirs.map((option) => option.props['checked'])).toEqual([true])
  })

  it('reports a chosen value to that field, and nothing to the other', () => {
    const onChoose = vi.fn()
    const { options } = render({ fields: [{ ...category, onChoose }, priority] })
    ;(options[0]?.props['onChange'] as () => void)()
    expect(onChoose).toHaveBeenCalledWith('question')
    expect(priority.onChoose).not.toHaveBeenCalled()
  })

  // The words are the state; the tone only tints what they already say.
  it("says what each field's row amounts to, and describes its options with it", () => {
    const { groups, byId, className } = render()
    expect(groups.map((group) => byId(group.props['aria-describedby']).props['children'])).toEqual([
      'Not reviewed',
      'Changing to Normal. Not saved yet.',
    ])
    expect(className('review-panel__state review-panel__state--none')).toHaveLength(1)
    expect(className('review-panel__state review-panel__state--pending')).toHaveLength(1)
  })

  it('names the advice, its note and who decided each field', () => {
    const { className, text } = render()
    expect(className('review-panel__advice').map((one) => one.props['children'])).toEqual([
      'Newsletter',
      'High',
    ])
    // In row order: the category has no advice note, so its decided-by line
    // comes first, then the priority's advice note and its decided-by line.
    expect(className('review-panel__cell-note').map((one) => one.props['children'])).toEqual([
      'Nobody. The model decided this.',
      'The model was not sure of this.',
      'Nobody. The model decided this.',
    ])
    expect(text('span')).toContain('Model advises')
    expect(text('span')).toContain('Decided by')
  })

  it('offers undo only for a field whose caller gives one, named for that field', () => {
    const { buttons } = render()
    const undos = buttons.filter((button) => button.props['variant'] === 'quiet')
    expect(undos).toHaveLength(1)
    expect(undos[0]?.props['children']).toBe('Undo')
    // Two fields would otherwise offer two buttons of the same name.
    expect(undos[0]?.props['aria-label']).toBe('Undo, Priority')
    expect(undos[0]?.props['onClick']).toBe(priority.onUndo)
  })

  it('disables a field the caller has locked, options and undo alike', () => {
    const { options, buttons } = render({
      fields: [{ ...priority, disabled: true }],
    })
    expect(options.every((option) => option.props['disabled'] === true)).toBe(true)
    expect(buttons.some((button) => button.props['disabled'] === true)).toBe(true)
  })

  it('lists one line per ground under the reason, as text', () => {
    const reasons = ['Category score below the threshold.', 'Signal: it asks for a code.']
    const { find, text } = render({ reasons })

    expect(find((element) => element.type === 'ul')).toHaveLength(1)
    expect(text('li')).toEqual(reasons)
  })

  it('shows no list at all where the caller gives no ground', () => {
    for (const reasons of [undefined, []]) {
      const { find } = render({ reasons })
      expect(find((element) => element.type === 'ul')).toHaveLength(0)
    }
  })

  it('shows every ground as its own text node, never as markup', () => {
    // The caller owns this copy, and React escapes it: a line is read, not
    // parsed, so nothing a ground says can become an element.
    const line = '<b>Signal</b>: it asks for a password'
    const { text, find } = render({ reasons: [line] })

    expect(text('li')).toEqual([line])
    expect(find((element) => element.type === 'b')).toHaveLength(0)
  })

  it("keeps the caller's kept-advice line and out-of-scope line as text", () => {
    const { className } = render({ outOfScope: 'Reply expectations are not confirmed here.' })
    expect(first(className('review-panel__note')).props['children']).toBe(base.keptNote)
    expect(className('review-panel__hint').map((one) => one.props['children'])).toEqual([
      base.fieldsHint,
      'Reply expectations are not confirmed here.',
    ])
  })

  it('shows the score rounded and bounded to 100', () => {
    const score = (value: number) => render({ score: value }).one('p').props['children']
    expect(score(57.6)).toEqual([expect.anything(), 'Model score', ' · ', '58/100'])
    expect((score(140) as unknown[])[3]).toBe('100/100')
    expect((score(-3) as unknown[])[3]).toBe('0/100')
  })

  it('saves through the caller, and offers the label it was given', () => {
    const onSave = vi.fn()
    const { save } = render({ onSave })
    expect(save.props['disabled']).toBe(false)
    expect(save.props['onClick']).toBe(onSave)
    expect(save.props['children']).toEqual([expect.anything(), 'Save 1 field'])
  })

  it('disables save whenever the caller says there is nothing to save', () => {
    expect(render({ saveDisabled: true }).save.props['disabled']).toBe(true)
  })

  it('shows caller result copy without a live region of its own', () => {
    const { find, text } = render({ result: { title: 'Saved', detail: 'Advice stays.' } })
    expect(text('strong')).toEqual(['Saved'])
    expect(text('span')).toContain('Advice stays.')
    const live = find((element) => 'aria-live' in element.props || 'role' in element.props)
    expect(live.map((element) => element.props['role'])).toEqual([
      'group',
      'radiogroup',
      'radiogroup',
    ])
    expect(render({ result: undefined }).text('strong')).toEqual([])
  })
})
