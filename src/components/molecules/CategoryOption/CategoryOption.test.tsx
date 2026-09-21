import type * as React from 'react'
import type { ChangeEvent, ReactElement } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { Icon } from '../../atoms/Icon/Icon'
import { CategoryOption } from './CategoryOption'

// CategoryOption calls only useId. Replacing it lets the test call the
// component as a plain function and read the elements that reach the DOM.
// Keyboard, focus and rendering are checked in Storybook.
let nextId = 0
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof React>()),
  useId: () => `id${String(nextId++)}`,
}))

type Element = ReactElement<Record<string, unknown>>

function render(props: Parameters<typeof CategoryOption>[0]) {
  const label = CategoryOption(props) as Element
  const [text, mark] = label.props['children'] as [Element, Element]
  const [name, description] = text.props['children'] as [Element, Element | undefined]
  const [input, icon] = mark.props['children'] as [Element, Element]
  return { label, name, description, input, icon }
}

const base = { name: 'category', value: 'invoice', label: 'Invoice' }

describe('CategoryOption', () => {
  it('wraps a native radio in its label', () => {
    const { label, input, icon } = render(base)
    expect(label.type).toBe('label')
    expect(label.props['className']).toBe('category-option')
    expect(input.type).toBe('input')
    expect(input.props).toMatchObject({ type: 'radio', name: 'category', value: 'invoice' })
    expect(icon.type).toBe(Icon)
    expect(icon.props).toEqual({ name: 'check', size: 'sm' })
  })

  it('names the radio by its label only', () => {
    const { name, description, input } = render(base)
    expect(name.props['children']).toBe('Invoice')
    expect(input.props['aria-labelledby']).toBe(name.props['id'])
    expect(description).toBeFalsy()
    expect(input.props['aria-describedby']).toBeUndefined()
  })

  it('describes the radio with the supporting text', () => {
    const { name, description, input } = render({ ...base, description: 'Payment requests' })
    expect(description?.props['children']).toBe('Payment requests')
    expect(input.props['aria-describedby']).toBe(description?.props['id'])
    expect(description?.props['id']).not.toBe(name.props['id'])
  })

  it('passes checked and disabled to the input and classes to the label', () => {
    const { label, input } = render({ ...base, checked: true, disabled: true, className: 'x' })
    expect(label.props['className']).toBe('category-option x')
    expect(input.props).toMatchObject({ checked: true, disabled: true })
  })

  it('hands the native change and input events to the caller', () => {
    const onChange = vi.fn()
    const onInput = vi.fn()
    const { input } = render({ ...base, onChange, onInput })
    const event = { currentTarget: { value: 'invoice' } } as ChangeEvent<HTMLInputElement>
    ;(input.props['onChange'] as (event: unknown) => void)(event)
    ;(input.props['onInput'] as (event: unknown) => void)(event)
    expect(onChange).toHaveBeenCalledWith(event)
    expect(onInput).toHaveBeenCalledWith(event)
  })

  it('groups options through the shared name, with one checked', () => {
    const selected = 'personal'
    const inputs = ['invoice', 'personal', 'other'].map(
      (value) => render({ ...base, value, label: value, checked: selected === value }).input,
    )
    expect(inputs.map((input) => input.props['name'])).toEqual(['category', 'category', 'category'])
    expect(inputs.map((input) => input.props['checked'])).toEqual([false, true, false])
    const names = new Set(inputs.map((input) => input.props['aria-labelledby']))
    expect(names.size).toBe(3)
  })
})
