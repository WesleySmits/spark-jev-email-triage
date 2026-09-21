import type { ComponentProps, ReactElement } from 'react'
import { describe, expect, it } from 'vitest'
import { Button } from './Button'

// Button is a plain function of its props, so the returned element shows what
// reaches the DOM. Keyboard, focus and token rendering are checked in Storybook.
function render(props: ComponentProps<typeof Button>) {
  const element = Button(props) as ReactElement<Record<string, unknown>, string>
  return { type: element.type, props: element.props }
}

describe('Button', () => {
  it('renders a native button that does not submit forms by default', () => {
    const { type, props } = render({ children: 'Save review' })
    expect(type).toBe('button')
    expect(props).toEqual({
      type: 'button',
      className: 'button button--primary',
      children: 'Save review',
    })
  })

  it('keeps an explicit type', () => {
    expect(render({ type: 'submit' }).props['type']).toBe('submit')
  })

  it.each(['primary', 'secondary', 'quiet'] as const)('applies the %s variant', (variant) => {
    expect(render({ variant }).props['className']).toBe(`button button--${variant}`)
  })

  it('passes through the accessible name, disabled state and extra classes', () => {
    const { props } = render({
      'aria-label': 'Open in Spark, not available',
      className: 'extra',
      disabled: true,
    })
    expect(props).toMatchObject({
      'aria-label': 'Open in Spark, not available',
      className: 'button button--primary extra',
      disabled: true,
    })
    expect(props).not.toHaveProperty('variant')
  })
})
