import type { ReactElement } from 'react'
import { describe, expect, it } from 'vitest'
import { Checkbox } from './Checkbox'

type Element = ReactElement<Record<string, unknown>, string>

// Checkbox is a plain function of its props, so the returned elements show what
// reaches the DOM. Keyboard, focus and rendering are checked in Storybook.
function render(props: Parameters<typeof Checkbox>[0]) {
  const label = Checkbox(props) as Element
  const [input, text] = label.props['children'] as [Element, Element]
  return { label, input, text }
}

describe('Checkbox', () => {
  it('wraps a native checkbox in its label', () => {
    const { label, input, text } = render({ label: 'Select visible results' })
    expect(label.type).toBe('label')
    expect(input.type).toBe('input')
    expect(input.props['type']).toBe('checkbox')
    expect(text.props['children']).toBe('Select visible results')
    expect(text.props['className']).toBe('checkbox__label')
  })

  it('hides the label visually but keeps the name', () => {
    const { text } = render({ label: 'Select Invoice March', hideLabel: true })
    expect(text.props['children']).toBe('Select Invoice March')
    expect(text.props['className']).toBe('checkbox__label checkbox__label--hidden')
  })

  it('passes native props to the input and classes to the label', () => {
    const { label, input } = render({
      label: 'Done',
      name: 'done',
      disabled: true,
      defaultChecked: true,
      className: 'extra',
    })
    expect(label.props['className']).toBe('checkbox extra')
    expect(input.props).toMatchObject({ name: 'done', disabled: true, defaultChecked: true })
  })

  it.each([true, false])('sets indeterminate to %s on the input', (indeterminate) => {
    const { input } = render({ label: 'Select all', indeterminate })
    const node = { indeterminate: !indeterminate }
    ;(input.props['ref'] as (node: unknown) => void)(node)
    expect(node.indeterminate).toBe(indeterminate)
  })
})
