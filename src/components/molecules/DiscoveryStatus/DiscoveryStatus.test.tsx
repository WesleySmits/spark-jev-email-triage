import type { ReactElement, ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { Button } from '../../atoms/Button/Button'
import { DiscoveryStatus, type DiscoveryStatusProps } from './DiscoveryStatus'

type Element = ReactElement<Record<string, unknown>>

const leaves = new Set<unknown>([Button])

function flatten(node: ReactNode): Element[] {
  if (Array.isArray(node)) return node.flatMap((child: ReactNode) => flatten(child))
  if (!node || typeof node !== 'object' || !('props' in node)) return []
  const element = node as Element
  if (typeof element.type === 'function' && !leaves.has(element.type)) {
    return flatten((element.type as (props: unknown) => ReactNode)(element.props))
  }
  return [element, ...flatten(element.props['children'] as ReactNode)]
}

function textOf(node: ReactNode): string {
  if (Array.isArray(node)) return node.map((child: ReactNode) => textOf(child)).join('')
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (!node || typeof node !== 'object' || !('props' in node)) return ''
  return textOf((node as Element).props['children'] as ReactNode)
}

const scope: NonNullable<DiscoveryStatusProps['scope']> = {
  view: 'unread',
  query: 'cedar',
  fields: ['sender', 'subject'],
  valuesMayBeTruncated: true,
  pageSize: 10,
  cursor: '11111111-1111-4111-8111-111111111111',
  mailboxes: [],
  failed: [],
  incomplete: [],
  readable: 2,
  scanned: 38,
  matched: 3,
  bounded: true,
  searchedAt: '14:32',
  searchCompletedAt: '2026-09-24T12:32:00.000Z',
}

describe('DiscoveryStatus', () => {
  it('states the query, counted reach, limited fields and completion time', () => {
    const rendered = DiscoveryStatus({ scope, loading: false, onContinue: vi.fn() })
    const elements = flatten(rendered)
    const text = textOf(rendered)
    const [time] = elements.filter((element) => element.type === 'time')

    expect(text).toContain('“cedar”')
    expect(text).toContain('3 matches · 38 copies scanned')
    expect(text).toContain('Sender + subject only · listed values may be truncated')
    expect(time?.props).toMatchObject({
      dateTime: '2026-09-24T12:32:00.000Z',
      children: ['Searched ', '14:32'],
    })
  })

  it('continues only while bounded and disables the action while searching', () => {
    const onContinue = vi.fn()
    const elements = flatten(DiscoveryStatus({ scope, loading: true, onContinue }))
    const [button] = elements.filter((element) => element.type === Button)

    expect(button?.props).toMatchObject({ disabled: true, children: 'Searching…' })
    ;(button?.props['onClick'] as () => void)()
    expect(onContinue).toHaveBeenCalledOnce()
    expect(
      flatten(
        DiscoveryStatus({ scope: { ...scope, bounded: false }, loading: false, onContinue }),
      ).filter((element) => element.type === Button),
    ).toHaveLength(0)
  })

  it('reports partial and request failures without provider detail', () => {
    const partial = DiscoveryStatus({
      scope: {
        ...scope,
        failed: [{ id: 'one@mail.example', label: 'one@mail.example', reason: 'failed' }],
      },
      loading: false,
      onContinue: vi.fn(),
    })
    expect(textOf(partial)).toContain('1 mailbox could not be searched completely')
    const failed = flatten(
      DiscoveryStatus({
        error: 'Search unavailable. Try again.',
        loading: false,
        onContinue: vi.fn(),
      }),
    )
    expect(failed[0]?.props).toMatchObject({
      role: 'status',
      children: 'Search unavailable. Try again.',
    })
  })
})
