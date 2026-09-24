import type { ReactElement, ReactNode } from 'react'
import { describe, expect, it } from 'vitest'
import { inboxCoverage, unscannedCoverage, viewCoverage } from '../../../app/inbox-coverage'
import { InboxZeroStatusBar } from './InboxZeroStatusBar'

type Element = ReactElement<Record<string, unknown>>

function isElement(node: unknown): node is Element {
  return typeof node === 'object' && node !== null && 'props' in node
}

function descendants(element: Element): Element[] {
  return ([] as ReactNode[])
    .concat(element.props['children'] as ReactNode)
    .filter(isElement)
    .flatMap((child) => [child, ...descendants(child)])
}

const view = (kind: 'unread' | 'other', loaded = 0) =>
  viewCoverage({
    view: kind,
    mailboxes: [{ id: 'one@mail.example', label: 'one@mail.example', loaded, bounded: false }],
    failed: [],
    incomplete: [],
    readable: 1,
    loaded,
    bounded: false,
    startedAt: '2026-09-24T09:42:00.000Z',
    refreshedAt: kind === 'unread' ? '2026-09-24T09:43:00.000Z' : '2026-09-24T09:44:00.000Z',
  })

function textContent(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (!isElement(node)) return Array.isArray(node) ? node.map(textContent).join('') : ''
  return textContent(node.props['children'] as ReactNode)
}

describe('InboxZeroStatusBar', () => {
  it('shows a confirmed zero only for the contract-confirmed state', () => {
    const unread = inboxCoverage(undefined, view('unread'))
    const coverage = inboxCoverage(unread, view('other'))
    const root = InboxZeroStatusBar({ coverage }) as Element

    expect(coverage.zero).toBe('confirmed')
    expect(textContent(root)).toContain('Inbox Zero confirmed')
    expect(textContent(root)).toContain('Non-atomic scan')
    expect(descendants(root).filter((element) => element.type === 'time')).toHaveLength(2)
  })

  it('names an unscanned view as incomplete and keeps zero unknown', () => {
    const coverage = inboxCoverage(undefined, view('unread'))
    const root = InboxZeroStatusBar({ coverage }) as Element

    expect(coverage.zero).toBe('unknown')
    expect(coverage.read).toEqual(unscannedCoverage('other'))
    expect(textContent(root)).toContain('Inbox Zero unknown')
    expect(textContent(root)).toContain('Other Inbox is not fully scanned')
    expect(textContent(root)).toContain('Other InboxIncomplete · 0')
    expect(
      descendants(root).some(
        (element) =>
          element.type === 'button' || element.type === 'a' || 'tabIndex' in element.props,
      ),
    ).toBe(false)
  })

  it('does not turn loaded messages into a zero claim', () => {
    const unread = inboxCoverage(undefined, view('unread'))
    const coverage = inboxCoverage(unread, view('other', 2))
    const root = InboxZeroStatusBar({ coverage }) as Element

    expect(coverage.zero).toBe('not-confirmed')
    expect(textContent(root)).toContain('Inbox Zero not reached')
    expect(textContent(root)).toContain('Other InboxComplete · 2')
  })

  it.each(['incomplete', 'failed'] as const)(
    'keeps not reached ahead of an %s positive view',
    (result) => {
      const unread = inboxCoverage(undefined, view('unread'))
      const positive = { ...view('other', 23), result }
      const coverage = inboxCoverage(unread, positive)
      const root = InboxZeroStatusBar({ coverage }) as Element

      expect(coverage.zero).toBe('not-confirmed')
      expect(textContent(root)).toContain('Inbox Zero not reached')
      expect(textContent(root)).toContain(
        result === 'failed' ? 'Other Inbox failed to scan' : 'Other Inbox is not fully scanned',
      )
      expect(textContent(root)).toContain(
        `Other Inbox${result === 'failed' ? 'Failed' : 'Incomplete'} · 23`,
      )
    },
  )

  it('withholds an earlier confirmed claim while a refresh is pending', () => {
    const unread = inboxCoverage(undefined, view('unread'))
    const coverage = inboxCoverage(unread, view('other'))
    const root = InboxZeroStatusBar({ coverage, refreshing: true }) as Element

    expect(coverage.zero).toBe('confirmed')
    expect(textContent(root)).toContain('Inbox Zero verification pending')
    expect(textContent(root)).not.toContain('Inbox Zero confirmed')
    expect(root.props['aria-busy']).toBe(true)
  })
})
