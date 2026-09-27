import type * as React from 'react'
import type { ReactElement, ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { Badge } from '../../atoms/Badge/Badge'
import { Button } from '../../atoms/Button/Button'
import { CategoryOption } from '../../molecules/CategoryOption/CategoryOption'
import { HandlingPanel } from './HandlingPanel'

// The panel calls only useId. Replacing it lets the test call the component
// as a plain function and walk the elements it returns. Keyboard, focus and
// rendering are checked in Storybook.
let nextId = 0
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof React>()),
  useId: () => `id${String(nextId++)}`,
}))

type Element = ReactElement<Record<string, unknown>>
type Props = Parameters<typeof HandlingPanel>[0]

const leaves = new Set<unknown>([Badge, Button, CategoryOption])

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

const rendered = (props: Props) => flatten(HandlingPanel(props))

const options = (elements: Element[]) =>
  elements.filter((element) => element.type === CategoryOption)

/** The first button the panel rendered: record, or change where one is recorded. */
const button = (elements: Element[]) => elements.find((element) => element.type === Button)

const withClass = (elements: Element[], name: string) =>
  elements.filter((element) => element.props['className'] === name)

const base: Props = {
  title: 'What happens next?',
  summary: 'Choose the work owed for this exact message version.',
  options: [
    { value: 'handle_now', label: 'Handle now', effect: 'Propose guarded Spark Done.' },
    { value: 'reply_needed', label: 'Reply needed', effect: 'Keeps the work open here.' },
  ],
  chosen: null,
  onChoose: vi.fn(),
  note: 'The local outcomes send no Spark command.',
  recordLabel: 'Record decision',
  onRecord: vi.fn(),
}

describe('HandlingPanel', () => {
  it('offers every outcome as one radio in one group, with what it changes', () => {
    const elements = rendered(base)
    const group = withClass(elements, 'handling-panel__options')[0]
    expect(group?.props['role']).toBe('radiogroup')
    expect(options(elements).map((option) => option.props['label'])).toEqual([
      'Handle now',
      'Reply needed',
    ])
    expect(options(elements).map((option) => option.props['description'])).toEqual([
      'Propose guarded Spark Done.',
      'Keeps the work open here.',
    ])
    // One group name, so choosing one outcome unchooses the other.
    expect(new Set(options(elements).map((option) => option.props['name'])).size).toBe(1)
  })

  it('names the group by the panel title and describes it by the summary', () => {
    const elements = rendered(base)
    const title = withClass(elements, 'handling-panel__title')[0]
    const summary = withClass(elements, 'handling-panel__summary')[0]
    const group = withClass(elements, 'handling-panel__options')[0]
    expect(group?.props['aria-labelledby']).toBe(title?.props['id'])
    expect(group?.props['aria-describedby']).toBe(summary?.props['id'])
  })

  it('refuses an outcome in its own words rather than leaving it out', () => {
    const [handleNow, replyNeeded] = base.options
    const elements = rendered({
      ...base,
      options: [
        {
          ...handleNow,
          value: 'handle_now',
          label: 'Handle now',
          effect: 'No path.',
          disabled: true,
        },
        { ...replyNeeded, value: 'reply_needed', label: 'Reply needed', effect: 'Local only.' },
      ],
    })
    const [first, second] = options(elements)
    expect(first?.props['disabled']).toBe(true)
    expect(first?.props['description']).toBe('No path.')
    expect(second?.props['disabled']).toBe(false)
  })

  it('records nothing by itself: the caller owns the button and may refuse it', () => {
    const onRecord = vi.fn()
    const elements = rendered({ ...base, onRecord, recordDisabled: true })
    const record = button(elements)
    expect(record?.props['disabled']).toBe(true)
    expect(record?.props['onClick']).toBe(onRecord)
    expect(onRecord).not.toHaveBeenCalled()
  })

  it('replaces the chooser with the decision once one is recorded', () => {
    const onChange = vi.fn()
    const elements = rendered({
      ...base,
      recorded: {
        title: 'Handle now',
        detail: 'One guarded Spark Done is proposed below.',
        state: { label: 'Proposed, not run', tone: 'review' },
        changeLabel: 'Change decision',
        onChange,
      },
    })
    expect(options(elements)).toEqual([])
    expect(withClass(elements, 'handling-panel__decision-title')[0]?.props['children']).toBe(
      'Handle now',
    )
    const change = button(elements)
    expect(change?.props['children']).toBe('Change decision')
    expect(change?.props['disabled']).toBe(false)
  })

  it('refuses to take a locked decision back', () => {
    const elements = rendered({
      ...base,
      recorded: {
        title: 'Handle now',
        detail: 'Spark may have changed this message. This attempt is locked.',
        state: { label: 'Still open, unresolved', tone: 'danger' },
        changeLabel: 'Change decision',
        onChange: vi.fn(),
        changeDisabled: true,
      },
    })
    expect(button(elements)?.props['disabled']).toBe(true)
  })

  it('states what it changes as words, never as colour alone', () => {
    const elements = rendered({ ...base, tags: ['Decision', 'Spark unchanged'] })
    const tags = elements.filter((element) => element.type === Badge)
    expect(tags.map((tag) => tag.props['children'])).toEqual(['Decision', 'Spark unchanged'])
  })
})
