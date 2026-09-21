import type { ComponentProps, ReactElement } from 'react'
import { describe, expect, it } from 'vitest'
import { Button } from '../Button/Button'
import { Icon } from '../Icon/Icon'
import { IconButton } from './IconButton'

type Element = ReactElement<Record<string, unknown>, string>

// IconButton returns a Button element; rendering that Button shows what
// reaches the DOM. Keyboard, focus and size are checked in Storybook.
function render(props: ComponentProps<typeof IconButton>) {
  const element = IconButton(props) as ReactElement<ComponentProps<typeof Button>>
  const button = Button(element.props) as Element
  return { element, type: button.type, props: button.props }
}

describe('IconButton', () => {
  it('is a quiet native button named by its label with a decorative icon', () => {
    const { element, type, props } = render({ icon: 'back', label: 'Back to messages' })
    expect(element.type).toBe(Button)
    expect(type).toBe('button')
    expect(props).toMatchObject({
      type: 'button',
      'aria-label': 'Back to messages',
      className: 'button button--quiet icon-button',
    })
    const icon = props['children'] as ReactElement<ComponentProps<typeof Icon>>
    expect(icon.type).toBe(Icon)
    expect(icon.props).toEqual({ name: 'back' })
  })

  it('keeps an explicit type and applies the secondary variant', () => {
    const { props } = render({ icon: 'undo', label: 'Undo', type: 'submit', variant: 'secondary' })
    expect(props['type']).toBe('submit')
    expect(props['className']).toBe('button button--secondary icon-button')
  })

  it('passes native props and extra classes through', () => {
    const onClick = () => undefined
    const { props } = render({
      icon: 'more',
      label: 'More options',
      disabled: true,
      onClick,
      'aria-expanded': false,
      className: 'extra',
    })
    expect(props).toMatchObject({
      disabled: true,
      onClick,
      'aria-expanded': false,
      className: 'button button--quiet icon-button extra',
    })
    expect(props).not.toHaveProperty('icon')
    expect(props).not.toHaveProperty('label')
  })

  it('requires a label and allows no children or other naming', () => {
    // @ts-expect-error label is required
    render({ icon: 'more' })
    // @ts-expect-error children are the icon only
    render({ icon: 'more', label: 'More options', children: 'More' })
    // @ts-expect-error label is the accessible name
    render({ icon: 'more', label: 'More options', 'aria-label': 'Other' })
  })
})
