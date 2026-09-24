import type * as React from 'react'
import type { ReactElement, ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { AccountMarker } from '../../atoms/AccountMarker/AccountMarker'
import { MailboxReach, type MailboxReachItem } from './MailboxReach'

let nextId = 0
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof React>()),
  useId: () => `id${String(nextId++)}`,
}))

type Element = ReactElement<Record<string, unknown>>
type Props = Parameters<typeof MailboxReach>[0]

const leaves = new Set<unknown>([AccountMarker])

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

const items: readonly MailboxReachItem[] = [
  {
    id: 'studio@mail.example',
    label: 'studio@mail.example',
    account: 'studio',
    pages: 2,
    copies: 19,
    state: 'more',
    lastRead: { label: 'Last read 14:32', dateTime: '2026-09-24T12:32:00.000Z' },
  },
  {
    id: 'atelier@mail.example',
    label: 'atelier@mail.example',
    account: 'atelier',
    pages: 1,
    copies: 8,
    state: 'failed',
  },
]

function render(overrides: Partial<Props> = {}) {
  const props: Props = { items, selectedId: items[0]?.id, onSelect: vi.fn(), ...overrides }
  const elements = flatten(MailboxReach(props))
  const all = (type: unknown) => elements.filter((element) => element.type === type)
  const byClass = (name: string) =>
    elements.filter((element) => element.props['className'] === name)
  return { props, elements, all, byClass, root: elements[0] }
}

describe('MailboxReach', () => {
  it('is a named section and keeps every mailbox copy count visible', () => {
    const { root, all, byClass } = render()
    const [title] = byClass('mailbox-reach__title')

    expect(root?.type).toBe('section')
    expect(root?.props['aria-labelledby']).toBe(title?.props['id'])
    expect(title?.props['children']).toBe('Mailbox reach')
    expect(all(AccountMarker).map((marker) => marker.props['account'])).toEqual([
      'studio',
      'atelier',
    ])
    expect(
      byClass('mailbox-reach__detail').map((detail) =>
        (detail.props['children'] as ReactNode[])
          .filter((child) => typeof child === 'string')
          .join(''),
      ),
    ).toEqual(['2 pages · 19 copies', '1 page · 8 copies'])
  })

  it('marks the selected mailbox and reports its id when pressed', () => {
    const onSelect = vi.fn()
    const { all } = render({ onSelect })
    const buttons = all('button')

    expect(buttons[0]?.props['aria-pressed']).toBe(true)
    expect(buttons[1]?.props['aria-pressed']).toBe(false)
    ;(buttons[1]?.props['onClick'] as () => void)()
    expect(onSelect).toHaveBeenCalledExactlyOnceWith('atelier@mail.example')
  })

  it('offers every readable mailbox without inventing an account marker', () => {
    const onSelect = vi.fn()
    const { all } = render({ selectedId: null, allLabel: 'All readable mailboxes', onSelect })
    const [allMailboxes] = all('button')

    expect(allMailboxes?.props).toMatchObject({
      className: 'mailbox-reach__all',
      'aria-pressed': true,
      children: 'All readable mailboxes',
    })
    ;(allMailboxes?.props['onClick'] as () => void)()
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(null)
  })

  it('exposes a machine-readable last read time', () => {
    const [time] = render().all('time')

    expect(time?.props).toMatchObject({
      dateTime: '2026-09-24T12:32:00.000Z',
      children: 'Last read 14:32',
    })
  })

  it('keeps retry separate from selection and disables it while pending', () => {
    const onSelect = vi.fn()
    const onRetry = vi.fn()
    const { all } = render({
      onSelect,
      onRetry,
      retryingIds: new Set(['atelier@mail.example']),
    })
    const retry = all('button').find(
      (button) => button.props['className'] === 'mailbox-reach__retry',
    )

    expect(retry?.props).toMatchObject({ disabled: true, children: 'Retrying…' })
    ;(retry?.props['onClick'] as () => void)()
    expect(onRetry).toHaveBeenCalledExactlyOnceWith('atelier@mail.example')
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('does not imply a retry action when none was provided', () => {
    expect(
      render()
        .all('button')
        .filter((button) => button.props['className'] === 'mailbox-reach__retry'),
    ).toHaveLength(0)
  })
})
