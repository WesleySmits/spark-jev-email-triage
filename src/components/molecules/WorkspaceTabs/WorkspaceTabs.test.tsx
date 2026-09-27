import type { ReactElement, ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { WorkspaceTabs } from './WorkspaceTabs'

// WorkspaceTabs is a plain function of its props, so the returned tree shows
// what reaches the DOM. Focus and layout are checked in Storybook.
type Element = ReactElement<Record<string, unknown>>

function isElement(node: unknown): node is Element {
  return typeof node === 'object' && node !== null && 'props' in node
}

function descendants(element: Element): Element[] {
  return ([] as ReactNode[])
    .concat(element.props['children'] as ReactNode)
    .flat()
    .filter(isElement)
    .flatMap((child) => [child, ...descendants(child)])
}

const tabs = [
  {
    id: 'inbox',
    label: 'Spark Inbox',
    count: '10 loaded',
    countLabel: 'messages loaded from Spark',
  },
  { id: 'work', label: 'Open work', count: '3', countLabel: 'open items saved in this app' },
]

function render(current = 'inbox', onSelect = vi.fn()) {
  const root = WorkspaceTabs({ label: 'Workbench lists', tabs, current, onSelect }) as Element
  const buttons = descendants(root).filter((element) => element.type === 'button')
  return { root, buttons, onSelect }
}

describe('WorkspaceTabs', () => {
  it('is a labelled navigation of plain buttons', () => {
    const { root, buttons } = render()
    expect(root.type).toBe('nav')
    expect(root.props['aria-label']).toBe('Workbench lists')
    expect(buttons.map((button) => button.props['type'])).toEqual(['button', 'button'])
  })

  it('marks only the tab that shows as current', () => {
    const { buttons } = render('work')
    expect(buttons.map((button) => button.props['aria-current'])).toEqual([undefined, 'page'])
  })

  it('says what each count is of, so two sources never read as one figure', () => {
    const { buttons } = render()
    const hidden = buttons.map((button) =>
      descendants(button).find((element) => element.props['className'] === 'workspace-tabs__sr'),
    )
    expect(hidden.map((element) => element?.props['children'])).toEqual([
      ': 10 loaded messages loaded from Spark',
      ': 3 open items saved in this app',
    ])
  })

  it('asks the caller to show the tab that was chosen', () => {
    const { buttons, onSelect } = render()
    const onClick = buttons[1]?.props['onClick'] as () => void
    onClick()
    expect(onSelect).toHaveBeenCalledWith('work')
  })
})
