import type * as React from 'react'
import type { ReactElement, ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { NavigationItem } from '../../molecules/NavigationItem/NavigationItem'
import { ShortcutLegend } from '../../molecules/ShortcutLegend/ShortcutLegend'
import { Sidebar, type SidebarGroup, type SidebarItem } from './Sidebar'

// Sidebar calls only useId. Replacing it lets the test call the component as a
// plain function and walk the elements it returns. Keyboard, focus, scrolling
// and layout are checked in Storybook.
let nextId = 0
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof React>()),
  useId: () => `id${String(nextId++)}`,
}))

type Element = ReactElement<Record<string, unknown>>
type Props = Parameters<typeof Sidebar>[0]

// Components from other folders stay as elements; the sidebar's own helper expands.
const leaves = new Set<unknown>([NavigationItem, ShortcutLegend])

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

const groups: readonly SidebarGroup[] = [
  {
    id: 'workflow',
    label: 'Workflow',
    selectedId: 'review',
    items: [
      { id: 'review', icon: 'clock', label: 'Needs review', count: 3 },
      { id: 'done', icon: 'check', label: 'Done', count: 0, disabled: true },
    ],
  },
  {
    id: 'mailbox',
    label: 'Mailboxes',
    selectedId: null,
    items: [{ id: 'studio', account: 'studio', label: 'Studio Noord', count: 4 }],
  },
]

function render(overrides: Partial<Props> = {}) {
  const props: Props = { label: 'Filters', groups, onSelect: vi.fn(), ...overrides }
  const elements = flatten(Sidebar(props))
  const all = (type: unknown) => elements.filter((element) => element.type === type)
  const byClass = (name: string) => elements.filter((e) => e.props['className'] === name)
  return { props, elements, all, byClass, root: elements[0] }
}

describe('Sidebar', () => {
  it('is a complementary landmark named by its label', () => {
    const { root } = render({ className: 'extra' })
    expect(root?.type).toBe('aside')
    expect(root?.props).toMatchObject({ 'aria-label': 'Filters', className: 'sidebar extra' })
  })

  it('names each group nav by its visible overline, with unique ids', () => {
    const { all } = render()
    const navs = all('nav')
    const labels = all('p').filter((p) => p.props['className'] === 'sidebar__label')
    expect(navs).toHaveLength(2)
    expect(labels.map((label) => label.props['children'])).toEqual(['Workflow', 'Mailboxes'])
    for (const [index, nav] of navs.entries()) {
      expect(nav.props['aria-labelledby']).toBe(labels[index]?.props['id'])
    }
    expect(new Set(labels.map((label) => label.props['id'])).size).toBe(2)
  })

  it('lists each item as a NavigationItem in a list item', () => {
    const { all } = render()
    const lists = all('ul')
    expect(lists.map((list) => list.props['role'])).toEqual(['list', 'list'])
    expect(all('li')).toHaveLength(3)
    const items = all(NavigationItem)
    expect(items.map((item) => item.props)).toMatchObject([
      { icon: 'clock', label: 'Needs review', count: 3, active: true, disabled: undefined },
      { icon: 'check', label: 'Done', count: 0, active: false, disabled: true },
      { account: 'studio', label: 'Studio Noord', count: 4, active: false },
    ])
    expect(items[2]?.props).not.toHaveProperty('icon')
  })

  it('reports the group and item when a row is pressed', () => {
    const { all, props } = render()
    const [, , studio] = all(NavigationItem)
    ;(studio?.props['onClick'] as () => void)()
    expect(props.onSelect).toHaveBeenCalledExactlyOnceWith('mailbox', 'studio')
  })

  it('shows an empty group with its empty label, and leaves it out without one', () => {
    const empty = { id: 'mailbox', label: 'Mailboxes', items: [] }
    const shown = render({ groups: [{ ...empty, emptyLabel: 'No mailboxes connected' }] })
    expect(shown.all('nav')).toHaveLength(1)
    expect(shown.all('ul')).toHaveLength(0)
    expect(shown.byClass('sidebar__empty')[0]?.props['children']).toBe('No mailboxes connected')
    expect(render({ groups: [empty] }).all('nav')).toHaveLength(0)
  })

  it('puts the shortcut legend in a fixed help area only when there are shortcuts', () => {
    const shortcuts = [{ label: 'Complete', keys: ['E'] }] as const
    const { byClass, all } = render({ shortcuts })
    const [help] = byClass('sidebar__help')
    expect(help?.props['children']).toMatchObject({ type: ShortcutLegend, props: { shortcuts } })
    expect(all(ShortcutLegend)).toHaveLength(1)
    expect(render().byClass('sidebar__help')).toHaveLength(0)
    expect(render({ shortcuts: [] }).byClass('sidebar__help')).toHaveLength(0)
  })

  it('rejects an item with no lead or with both leads', () => {
    // @ts-expect-error an icon or an account is required
    const missing: SidebarItem = { id: 'a', label: 'A' }
    // @ts-expect-error an icon and an account together are invalid
    const doubled: SidebarItem = { id: 'b', label: 'B', icon: 'inbox', account: 'studio' }
    expect([missing, doubled]).toHaveLength(2)
  })
})
