import type { ReactElement } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { KeyboardHint } from '../../atoms/KeyboardHint/KeyboardHint'
import { SearchInput } from '../../atoms/SearchInput/SearchInput'
import { SearchField } from './SearchField'

type Element = ReactElement<Record<string, unknown>>

function render(props: Parameters<typeof SearchField>[0]) {
  const root = SearchField(props) as Element
  const [input, hint] = root.props['children'] as [Element, Element | false]
  return { root, input, hint }
}

describe('SearchField', () => {
  it('composes a SearchInput with a hidden / hint', () => {
    const { root, input, hint } = render({ label: 'Search current results' })
    expect(root.type).toBe('div')
    expect(root.props['className']).toBe('search-field')
    expect(input.type).toBe(SearchInput)
    expect(input.props).toMatchObject({
      label: 'Search current results',
      'aria-keyshortcuts': '/',
      className: 'search-field__input search-field__input--hint',
    })
    expect(hint).toMatchObject({ type: 'span', props: { 'aria-hidden': 'true' } })
    const key = (hint as Element).props['children'] as Element
    expect(key.type).toBe(KeyboardHint)
    expect(key.props['children']).toBe('/')
  })

  it('passes the value and change handler through untouched', () => {
    const onChange = vi.fn()
    const { root, input } = render({
      label: 'Search',
      placeholder: 'Search current results',
      value: 'invoice',
      onChange,
      name: 'q',
      className: 'extra',
    })
    expect(root.props['className']).toBe('search-field extra')
    expect(input.props).toMatchObject({
      placeholder: 'Search current results',
      value: 'invoice',
      onChange,
      name: 'q',
    })
  })

  it('drops the hint and shortcut when disabled or turned off', () => {
    for (const props of [{ disabled: true }, { shortcut: false }]) {
      const { input, hint } = render({ label: 'Search', ...props })
      expect(hint).toBe(false)
      expect(input.props).not.toHaveProperty('aria-keyshortcuts')
      expect(input.props['className']).toBe('search-field__input')
    }
    expect(render({ label: 'Search', disabled: true }).input.props['disabled']).toBe(true)
  })
})
