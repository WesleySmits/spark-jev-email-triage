import type * as React from 'react'
import type { ReactElement, ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { BulkActionBar } from '../../molecules/BulkActionBar/BulkActionBar'
import { MessageRow } from '../../molecules/MessageRow/MessageRow'
import { QueueHeader } from '../../molecules/QueueHeader/QueueHeader'
import { MessageQueue, type QueueMessage } from './MessageQueue'

// MessageQueue calls only useId. Replacing it lets the test call the component
// as a plain function and walk the elements it returns. Scrolling, focus and
// reflow are checked in Storybook.
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof React>()),
  useId: () => 'queue-title',
}))

type Element = ReactElement<Record<string, unknown>>
type Props = Parameters<typeof MessageQueue>[0]

// Components from other folders stay as elements; the queue's own row expands.
const leaves = new Set<unknown>([QueueHeader, BulkActionBar, MessageRow])

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

const messages: QueueMessage[] = [
  {
    id: 'm1',
    sender: 'Marit Vos',
    time: '09:42',
    subject: 'Can delivery move a week earlier?',
    snippet: 'After our meeting…',
    account: { marker: 'studio', label: 'Studio Noord' },
    status: { label: 'Needs review', tone: 'review' },
    unread: true,
  },
  {
    id: 'm2',
    sender: 'Daan Kramer',
    time: '08:17',
    subject: 'Invoice correction',
    snippet: 'The company name…',
    account: { marker: 'atelier', label: 'Atelier Linden' },
    status: { label: 'Action needed', tone: 'neutral' },
  },
]

function render(overrides: Partial<Props> = {}) {
  const props: Props = {
    header: { title: 'Needs review', count: '2 results' },
    messages,
    onOpen: vi.fn(),
    ...overrides,
  }
  const root = MessageQueue(props) as Element
  const all = [root, ...flatten(root.props['children'] as ReactNode)]
  const rows = all.filter((element) => element.type === MessageRow)
  const items = all.filter((element) => element.type === 'li')
  const list = all.find((element) => element.type === 'ul')
  return { props, root, all, rows, items, list }
}

describe('MessageQueue', () => {
  it('is a region named by the header title', () => {
    const { root, all } = render({ header: { title: 'Inbox', count: '2 results', context: 'All' } })
    expect(root.type).toBe('section')
    expect(root.props).toMatchObject({
      className: 'message-queue',
      'aria-labelledby': 'queue-title',
    })
    const header = all.find((element) => element.type === QueueHeader)
    expect(header?.props).toEqual({
      title: 'Inbox',
      count: '2 results',
      context: 'All',
      titleId: 'queue-title',
    })
  })

  it('renders one list item per message, keyed by id, in the given order', () => {
    const { list, items, rows } = render()
    expect(list?.props['role']).toBe('list')
    expect(items.map((item) => item.key)).toEqual(['m1', 'm2'])
    expect(rows.map((row) => row.props['subject'])).toEqual([
      'Can delivery move a week earlier?',
      'Invoice correction',
    ])
    expect(rows[0]?.props).not.toHaveProperty('id')
  })

  it('marks only the current row as selected and keeps unread per row', () => {
    const { rows } = render({ currentId: 'm2' })
    expect(rows.map((row) => row.props['selected'])).toEqual([false, true])
    expect(rows.map((row) => row.props['unread'])).toEqual([true, undefined])
  })

  it('marks no row as current without a current id', () => {
    const { rows } = render({ currentId: null })
    expect(rows.map((row) => row.props['selected'])).toEqual([false, false])
  })

  it('opens a row through the caller with its id', () => {
    const onOpen = vi.fn()
    const { rows } = render({ onOpen })
    ;(rows[1]?.props['onActivate'] as () => void)()
    expect(onOpen).toHaveBeenCalledExactlyOnceWith('m2')
  })

  it('omits row checkboxes without selection', () => {
    const { rows } = render()
    expect(rows.every((row) => row.props['selection'] === undefined)).toBe(true)
  })

  it('checks rows from the caller-owned set and reports changes by id', () => {
    const onChange = vi.fn()
    const { rows } = render({
      currentId: 'm1',
      selection: {
        selectedIds: new Set(['m2']),
        label: (message) => `Select ${message.subject}`,
        onChange,
      },
    })
    const selections = rows.map(
      (row) =>
        row.props['selection'] as {
          label: string
          checked: boolean
          onChange: (checked: boolean) => void
        },
    )
    expect(selections.map(({ label, checked }) => ({ label, checked }))).toEqual([
      { label: 'Select Can delivery move a week earlier?', checked: false },
      { label: 'Select Invoice correction', checked: true },
    ])
    // Checked and current stay independent.
    expect(rows.map((row) => row.props['selected'])).toEqual([true, false])
    selections[0]?.onChange(true)
    expect(onChange).toHaveBeenCalledExactlyOnceWith('m1', true)
  })

  it('renders every group as a titled section with its own list, empty ones as a title', () => {
    const [first, second] = messages
    const groups = [
      { id: 'review', title: 'Needs review', note: '1 of 2 loaded', messages: [first] },
      { id: 'attention', title: 'Attention', note: '0 of 2 loaded', messages: [] },
      { id: 'info', title: 'Informational', note: '1 of 2 loaded', messages: [second] },
    ].map((group) => ({ ...group, messages: group.messages.filter((m) => m !== undefined) }))
    const { all, rows, items } = render({
      groups,
      header: { title: 'Unread', count: '2 results', headingLevel: 1 },
    })
    const sections = all.filter((element) => element.type === 'section' && element !== all[0])
    const titles = all.filter((element) => element.type === 'h2')
    expect(sections).toHaveLength(3)
    expect(titles.map((title) => title.props['id'])).toEqual([
      'queue-title',
      'queue-title',
      'queue-title',
    ])
    expect(sections.map((section) => section.props['aria-labelledby'])).toEqual([
      'queue-title',
      'queue-title',
      'queue-title',
    ])
    expect(
      titles.map((title) =>
        flatten(title.props['children'] as ReactNode).map((c) => c.props['children']),
      ),
    ).toEqual([
      ['Needs review', '1 of 2 loaded'],
      ['Attention', '0 of 2 loaded'],
      ['Informational', '1 of 2 loaded'],
    ])
    // The empty group has a title and no list; the rows keep their group order.
    expect(all.filter((element) => element.type === 'ul')).toHaveLength(3)
    expect(rows.map((row) => row.props['subject'])).toEqual([
      'Can delivery move a week earlier?',
      'Invoice correction',
    ])
    expect(items.filter((item) => item.props['className'] === 'message-queue__group')).toHaveLength(
      3,
    )
  })

  it('heads groups one level under the queue title', () => {
    const groups = [{ id: 'g', title: 'Needs review', messages }]
    expect(render({ groups }).all.some((element) => element.type === 'h3')).toBe(true)
    expect(
      render({ groups, header: { title: 'Unread', count: '2 results', headingLevel: 3 } }).all.some(
        (element) => element.type === 'h4',
      ),
    ).toBe(true)
  })

  it('shows the empty slot rather than empty groups when there are no messages', () => {
    const empty = <p className="custom-empty">No results</p>
    const groups = [{ id: 'g', title: 'Needs review', messages: [] }]
    const { all } = render({ messages: [], groups, empty })
    expect(all.some((element) => element.type === 'section' && element !== all[0])).toBe(false)
    expect(all.find((element) => element.props['className'] === 'custom-empty')).toBe(empty)
  })

  it('renders the bulk action bar only when given', () => {
    expect(render().all.some((element) => element.type === BulkActionBar)).toBe(false)
    const bulkActions = { label: 'Bulk actions', count: '1 result selected' }
    const bar = render({ bulkActions }).all.find((element) => element.type === BulkActionBar)
    expect(bar?.props).toEqual(bulkActions)
  })

  it('shows the empty slot instead of a list when there are no messages', () => {
    const empty = <p className="custom-empty">No results</p>
    const { list, rows, all } = render({ messages: [], empty })
    expect(list).toBeUndefined()
    expect(rows).toHaveLength(0)
    expect(all.find((element) => element.props['className'] === 'custom-empty')).toBe(empty)
  })

  it('renders an empty body without a slot', () => {
    const { list, all } = render({ messages: [] })
    expect(list).toBeUndefined()
    const body = all.find((element) => element.props['className'] === 'message-queue__body')
    expect(body?.props['children']).toBeUndefined()
  })

  it('appends a caller class', () => {
    expect(render({ className: 'app-queue' }).root.props['className']).toBe(
      'message-queue app-queue',
    )
  })
})
