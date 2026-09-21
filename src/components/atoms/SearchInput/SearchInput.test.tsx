import type { ReactElement } from 'react'
import { describe, expect, it } from 'vitest'
import { Icon } from '../Icon/Icon'
import { SearchInput } from './SearchInput'

type Element = ReactElement<Record<string, unknown>>

function render(props: Parameters<typeof SearchInput>[0]) {
  const label = SearchInput(props) as Element
  const [icon, input] = label.props['children'] as [Element, Element]
  return { label, icon, input }
}

describe('SearchInput', () => {
  it('names a native search field inside a clickable label', () => {
    const { label, icon, input } = render({ label: 'Search current results' })
    expect(label.type).toBe('label')
    expect(label.props['className']).toBe('search-input')
    expect(icon.type).toBe(Icon)
    expect(icon.props).toEqual({ name: 'search', size: 'sm' })
    expect(input.type).toBe('input')
    expect(input.props).toMatchObject({ type: 'search', 'aria-label': 'Search current results' })
  })

  it('passes native props to the input and classes to the label', () => {
    const { label, input } = render({
      label: 'Search',
      placeholder: 'Search current results',
      disabled: true,
      className: 'extra',
    })
    expect(label.props['className']).toBe('search-input extra')
    expect(input.props).toMatchObject({ placeholder: 'Search current results', disabled: true })
  })
})
