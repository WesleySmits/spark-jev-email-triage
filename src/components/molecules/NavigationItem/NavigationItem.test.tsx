import type { ComponentProps, ReactElement } from 'react'
import { describe, expect, it } from 'vitest'
import { AccountMarker } from '../../atoms/AccountMarker/AccountMarker'
import { Icon } from '../../atoms/Icon/Icon'
import { NavigationItem } from './NavigationItem'

type Element = ReactElement<Record<string, unknown>>

// NavigationItem has no hooks, so the test calls it as a plain function and
// reads the elements that reach the DOM. Keyboard, focus and layout are
// checked in Storybook.
function render(props: ComponentProps<typeof NavigationItem>) {
  const button = NavigationItem(props) as Element
  const [lead, label, count] = button.props['children'] as [Element, Element, Element | false]
  return { button, lead, label, count }
}

describe('NavigationItem', () => {
  it('is a native button that never submits a form', () => {
    const { button } = render({ icon: 'clock', label: 'Needs review' })
    expect(button.type).toBe('button')
    expect(button.props).toMatchObject({ type: 'button', className: 'navigation-item' })
  })

  it('is named by its visible label and count, with a decorative lead', () => {
    const { button, lead, label, count } = render({
      icon: 'clock',
      label: 'Needs review',
      count: 3,
    })
    expect(button.props['aria-label']).toBeUndefined()
    expect(label.props).toEqual({ className: 'navigation-item__label', children: 'Needs review' })
    expect(count).toMatchObject({ props: { className: 'navigation-item__count', children: 3 } })
    // Icon and AccountMarker are aria-hidden without a label.
    expect(lead.props).not.toHaveProperty('label')
  })

  it('exposes the active state as aria-pressed', () => {
    expect(render({ icon: 'clock', label: 'Needs review' }).button.props['aria-pressed']).toBe(
      false,
    )
    expect(
      render({ icon: 'clock', label: 'Needs review', active: true }).button.props['aria-pressed'],
    ).toBe(true)
  })

  it('shows a count of zero and leaves it out when not given', () => {
    expect(render({ icon: 'check', label: 'Done', count: 0 }).count).toMatchObject({
      props: { children: 0 },
    })
    expect(render({ icon: 'check', label: 'Done' }).count).toBe(false)
  })

  it('leads with a small icon or an account marker', () => {
    const withIcon = render({ icon: 'inbox', label: 'All accounts' }).lead
    expect(withIcon.type).toBe(Icon)
    expect(withIcon.props).toEqual({ name: 'inbox', size: 'sm' })
    const withAccount = render({ account: 'atelier', label: 'Atelier Linden' }).lead
    expect(withAccount.type).toBe(AccountMarker)
    expect(withAccount.props).toEqual({ account: 'atelier' })
  })

  it('passes disabled, click handling and classes through', () => {
    const onClick = () => undefined
    const { button } = render({
      account: 'personal',
      label: 'Personal',
      disabled: true,
      onClick,
      className: 'extra',
    })
    expect(button.props).toMatchObject({
      disabled: true,
      onClick,
      className: 'navigation-item extra',
    })
    expect(button.props).not.toHaveProperty('account')
    expect(button.props).not.toHaveProperty('active')
  })

  it('rejects a missing or doubled lead and other naming or state props', () => {
    // @ts-expect-error an icon or an account is required
    render({ label: 'Needs review' })
    // @ts-expect-error an icon and an account together are invalid
    render({ icon: 'inbox', account: 'studio', label: 'Studio Noord' })
    // @ts-expect-error label is the accessible name
    render({ icon: 'inbox', label: 'All accounts', 'aria-label': 'Other' })
    // @ts-expect-error active sets aria-pressed
    render({ icon: 'inbox', label: 'All accounts', 'aria-pressed': true })
    // @ts-expect-error the row is always a plain button
    render({ icon: 'inbox', label: 'All accounts', type: 'submit' })
    // @ts-expect-error children come from label and count
    render({ icon: 'inbox', label: 'All accounts', children: 'All' })
  })
})
