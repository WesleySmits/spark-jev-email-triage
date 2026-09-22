import { readFileSync } from 'node:fs'
import { parse, type AtRule } from 'postcss'
import type { ChangeEvent, ReactElement } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { Avatar } from '../../atoms/Avatar/Avatar'
import { Brand } from '../../molecules/Brand/Brand'
import { SearchField } from '../../molecules/SearchField/SearchField'
import { SyncStatusButton, SyncStatusText } from '../../molecules/SyncStatusButton/SyncStatusButton'
import { TopBar } from './TopBar'

type Element = ReactElement<Record<string, unknown>>
type Props = Parameters<typeof TopBar>[0]

// TopBar is a plain function of its props, so the returned element shows what
// it composes. Keyboard, focus, reflow and rendering are checked in Storybook.
const base: Props = {
  searchLabel: 'Zoek in huidige resultaten',
  searchPlaceholder: 'Zoek in huidige resultaten',
  searchValue: 'factuur',
  onSearchChange: vi.fn(),
  onSearchSubmit: vi.fn(),
  syncStatus: 'connected',
  syncLabel: 'Bijgewerkt 2 min geleden',
  onSyncClick: vi.fn(),
  profileLabel: 'Profiel Wesley Smits',
  profileInitials: 'WS',
}

function render(overrides: Partial<Props> = {}) {
  const props = { ...base, ...overrides }
  const root = TopBar(props) as Element
  const [brand, form, sync, avatar] = root.props['children'] as Element[]
  if (!brand || !form || !sync || !avatar) throw new Error('Missing top bar part')
  const search = form.props['children'] as Element
  return { props, root, brand, form, search, sync, avatar }
}

function css() {
  return parse(readFileSync(new URL('./TopBar.css', import.meta.url), 'utf8'))
}

describe('TopBar', () => {
  it('is a header with brand, search landmark, sync status and avatar in order', () => {
    const { root, brand, form, search, sync, avatar } = render()
    expect(root.type).toBe('header')
    expect(root.props['className']).toBe('top-bar')
    expect(brand.type).toBe(Brand)
    expect(brand.props).toMatchObject({ className: 'top-bar__brand' })
    expect(form).toMatchObject({ type: 'form', props: { role: 'search' } })
    expect(search.type).toBe(SearchField)
    expect(sync.type).toBe(SyncStatusButton)
    expect(avatar.type).toBe(Avatar)
  })

  it('passes the caller copy and names through', () => {
    const { root, brand, search, sync, avatar } = render({
      productName: 'Spark Triage Werkbank',
      searchShortcut: false,
      searchId: 'search',
      className: 'extra',
    })
    expect(root.props['className']).toBe('top-bar extra')
    expect(brand.props['name']).toBe('Spark Triage Werkbank')
    expect(search.props).toMatchObject({
      id: 'search',
      label: 'Zoek in huidige resultaten',
      placeholder: 'Zoek in huidige resultaten',
      shortcut: false,
      value: 'factuur',
    })
    expect(sync.props).toMatchObject({
      status: 'connected',
      children: 'Bijgewerkt 2 min geleden',
      className: 'top-bar__sync',
    })
    expect(avatar.props).toEqual({ initials: 'WS', label: 'Profiel Wesley Smits', size: 'sm' })
  })

  it('disables the search while there is nothing to search', () => {
    expect(render().search.props['disabled']).toBeUndefined()
    expect(render({ searchDisabled: true }).search.props['disabled']).toBe(true)
  })

  it('names the sync button by what it does when the caller says so', () => {
    expect(render().sync.props['aria-label']).toBeUndefined()
    const { sync } = render({
      syncLabel: 'Updated at 09:42 · read only',
      syncActionLabel: 'Refresh mail · Updated at 09:42 · read only',
    })
    expect(sync.props).toMatchObject({
      'aria-label': 'Refresh mail · Updated at 09:42 · read only',
      children: 'Updated at 09:42 · read only',
    })
  })

  it('shows the status as plain text when a click would do nothing', () => {
    const { sync } = render({
      syncStatus: 'idle',
      syncLabel: 'Not on the Spark Mac',
      onSyncClick: undefined,
    })
    expect(sync.type).toBe(SyncStatusText)
    expect(sync.props).toMatchObject({
      status: 'idle',
      children: 'Not on the Spark Mac',
      className: 'top-bar__sync',
    })
  })

  it('reports edits as the new query', () => {
    const onSearchChange = vi.fn()
    const { search } = render({ onSearchChange })
    const onChange = search.props['onChange'] as (event: ChangeEvent<HTMLInputElement>) => void
    onChange({ target: { value: 'factuur 2026' } } as ChangeEvent<HTMLInputElement>)
    expect(onSearchChange).toHaveBeenCalledWith('factuur 2026')
  })

  it('submits the current query without navigating', () => {
    const onSearchSubmit = vi.fn()
    const preventDefault = vi.fn()
    const { form } = render({ onSearchSubmit })
    const onSubmit = form.props['onSubmit'] as (event: { preventDefault: () => void }) => void
    onSubmit({ preventDefault })
    expect(preventDefault).toHaveBeenCalledOnce()
    expect(onSearchSubmit).toHaveBeenCalledWith('factuur')
  })

  it('leaves the sync action and status to the caller', () => {
    const onSyncClick = vi.fn()
    const { sync } = render({
      onSyncClick,
      syncStatus: 'disconnected',
      syncLabel: 'Verbinding verbroken · laatste sync 10:14',
    })
    expect(sync.props).toMatchObject({
      onClick: onSyncClick,
      status: 'disconnected',
      children: 'Verbinding verbroken · laatste sync 10:14',
    })
    expect(onSyncClick).not.toHaveBeenCalled()
  })

  it('styles with tokens only', () => {
    const values: string[] = []
    css().walkDecls((declaration) => {
      values.push(declaration.value)
    })
    expect(values.filter((value) => /#[0-9a-f]{3,8}\b/i.test(value))).toEqual([])
  })

  it('gives search and sync 44px targets and its own search row below 600px', () => {
    const rules = new Map<string, Map<string, string>>()
    css().walkAtRules('media', (media: AtRule) => {
      if (media.params !== '(max-width: 600px)') return
      media.walkRules((rule) => {
        const declarations = new Map<string, string>()
        rule.walkDecls((declaration) => {
          declarations.set(declaration.prop, declaration.value)
        })
        rules.set(rule.selector, declarations)
      })
    })
    expect(rules.get('.top-bar')?.get('display')).toBe('grid')
    expect(rules.get('.top-bar__search')?.get('grid-column')).toBe('1 / -1')
    expect(rules.get('.top-bar__search .search-input')?.get('height')).toBe('44px')
    expect(rules.get('.top-bar .top-bar__sync')?.get('min-height')).toBe('44px')
  })
})
