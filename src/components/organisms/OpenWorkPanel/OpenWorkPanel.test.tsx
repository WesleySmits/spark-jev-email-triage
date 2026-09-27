import type * as React from 'react'
import type { ReactElement, ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { Badge } from '../../atoms/Badge/Badge'
import { Button } from '../../atoms/Button/Button'
import { EmptyState } from '../../molecules/EmptyState/EmptyState'
import { QueueHeader } from '../../molecules/QueueHeader/QueueHeader'
import { OpenWorkPanel, type OpenWorkItemView } from './OpenWorkPanel'

// The panel calls only useId. Replacing it lets the test call the component
// as a plain function and walk the elements it returns. Keyboard, focus and
// rendering are checked in Storybook.
let nextId = 0
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof React>()),
  useId: () => `id${String(nextId++)}`,
}))

type Element = ReactElement<Record<string, unknown>>
type Props = Parameters<typeof OpenWorkPanel>[0]

const leaves = new Set<unknown>([Badge, Button, EmptyState, QueueHeader])

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

const item = (id: string, extra: Partial<OpenWorkItemView> = {}): OpenWorkItemView => ({
  id,
  title: `Item ${id}`,
  source: `${id}@mail.example`,
  decision: { label: 'Reply needed', tone: 'review' },
  standing: { label: 'Open', tone: 'review' },
  saved: 'Saved by you',
  inbox: 'In Spark Inbox · unread',
  conflicts: [],
  ...extra,
})

const base: Props = {
  header: { title: 'Open work', count: '1 open', context: 'Not a Spark Inbox count.' },
  sections: [{ id: 'open', title: 'Open work', count: '1', items: [item('a')] }],
  onOpen: vi.fn(),
  onReopen: vi.fn(),
}

const rendered = (props: Partial<Props> = {}) => flatten(OpenWorkPanel({ ...base, ...props }))
const buttons = (elements: Element[]) => elements.filter((element) => element.type === Button)
const texts = (elements: Element[]) => elements.map((element) => element.props['children'])

describe('OpenWorkPanel', () => {
  it('names the region by its level 1 title and says where the counts come from', () => {
    const elements = rendered()
    const header = elements.find((element) => element.type === QueueHeader)
    expect(header?.props).toMatchObject({
      title: 'Open work',
      headingLevel: 1,
      context: 'Not a Spark Inbox count.',
    })
    expect(elements[0]?.props['aria-labelledby']).toBe(header?.props['titleId'])
  })

  it('states the decision and where it stands as words, never colour alone', () => {
    const badges = rendered().filter((element) => element.type === Badge)
    expect(texts(badges)).toEqual(['Reply needed', 'Open'])
  })

  it('offers Open only where the reading lists the copy, and Reopen only where offered', () => {
    expect(buttons(rendered())).toHaveLength(0)
    const actions = buttons(
      rendered({
        sections: [
          {
            id: 'x',
            title: 'X',
            count: '1',
            items: [item('a', { rowId: 'row-a', reopen: {} })],
          },
        ],
      }),
    )
    expect(texts(actions)).toEqual(['Open in reader', 'Reopen work'])
  })

  it('lists every conflict as a sentence', () => {
    const elements = rendered({
      sections: [
        { id: 'x', title: 'X', count: '1', items: [item('a', { conflicts: ['One.', 'Two.'] })] },
      ],
    })
    const list = elements.find((element) => element.props['aria-label'] === 'Conflicts')
    expect(list?.type).toBe('ul')
    expect(
      elements
        .filter((element) => element.type === 'li' && typeof element.props['children'] === 'string')
        .map((element) => element.props['children']),
    ).toEqual(['One.', 'Two.'])
  })

  it('disables a reopen while it is being saved', () => {
    const [reopen] = buttons(
      rendered({
        busyId: 'a',
        sections: [{ id: 'x', title: 'X', count: '1', items: [item('a', { reopen: {} })] }],
      }),
    )
    expect(reopen?.props).toMatchObject({ disabled: true, children: 'Reopening…' })
  })

  it('shows its empty state above any completed sections', () => {
    const elements = rendered({ empty: { title: 'No open work saved here', description: 'd' } })
    const empty = elements.find((element) => element.type === EmptyState)
    expect(empty?.props['title']).toBe('No open work saved here')
  })
})
