import { readFileSync } from 'node:fs'
import { parse } from 'postcss'
import type { ComponentProps, ReactElement, ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { contrastRatio } from '../../../foundations/contrast'
import { IconButton } from '../../atoms/IconButton/IconButton'
import { MobileReaderBar } from './MobileReaderBar'

// MobileReaderBar is a plain function of its props, so the returned tree shows
// what reaches the DOM. Keyboard, focus and reflow are checked in Storybook.
type Element = ReactElement<Record<string, unknown>>
type Props = ComponentProps<typeof MobileReaderBar>

function render(props: Partial<Props> = {}) {
  const root = MobileReaderBar({
    title: 'Studio Noord',
    context: '1 of 3 in Needs review',
    onBack: vi.fn(),
    ...props,
  }) as Element
  const children = ([] as ReactNode[])
    .concat(root.props['children'] as ReactNode)
    .filter((child): child is Element => typeof child === 'object' && child !== null)
  const buttons = children.filter((child) => child.type === IconButton)
  const text = children.find((child) => child.type === 'p')
  const [title, context] = text?.props['children'] as [Element, Element | undefined]
  return { root, buttons, text, title, context }
}

function tokens(): Map<string, string> {
  const values = new Map<string, string>()
  const file = readFileSync(new URL('../../../styles/tokens.css', import.meta.url), 'utf8')
  parse(file).walkDecls(/^--/, (declaration) => {
    values.set(declaration.prop, declaration.value)
  })
  return values
}

describe('MobileReaderBar', () => {
  it('renders a plain div with a back button and the context text', () => {
    const onBack = vi.fn()
    const { root, buttons, text, title, context } = render({ onBack })
    expect(root.type).toBe('div')
    expect(root.props['className']).toBe('mobile-reader-bar')
    expect(buttons).toHaveLength(1)
    expect(buttons[0]?.props).toMatchObject({
      icon: 'back',
      label: 'Back to messages',
      onClick: onBack,
    })
    expect(text?.props['className']).toBe('mobile-reader-bar__text')
    expect(title).toMatchObject({
      type: 'strong',
      props: { className: 'mobile-reader-bar__title', children: 'Studio Noord' },
    })
    expect(context).toMatchObject({
      type: 'span',
      props: { className: 'mobile-reader-bar__context', children: '1 of 3 in Needs review' },
    })
  })

  it('leaves out the context when not given', () => {
    expect(render({ context: undefined }).context).toBeUndefined()
  })

  it('calls the caller back from each button', () => {
    const onBack = vi.fn()
    const onMoreOptions = vi.fn()
    const { buttons } = render({ onBack, onMoreOptions })
    for (const button of buttons) (button.props['onClick'] as () => void)()
    expect(onBack).toHaveBeenCalledOnce()
    expect(onMoreOptions).toHaveBeenCalledOnce()
  })

  it('shows more options only with a handler, after the text', () => {
    const { root, buttons } = render({ onMoreOptions: vi.fn(), moreOptionsExpanded: false })
    const children = root.props['children'] as Element[]
    expect(children[2]).toBe(buttons[1])
    expect(buttons[1]?.props).toMatchObject({
      icon: 'more',
      label: 'More options',
      'aria-expanded': false,
    })
  })

  it('takes translated labels and extra classes', () => {
    const { root, buttons } = render({
      backLabel: 'Terug naar berichten',
      onMoreOptions: vi.fn(),
      moreOptionsLabel: 'Meer opties',
      className: 'extra',
    })
    expect(root.props['className']).toBe('mobile-reader-bar extra')
    expect(buttons.map((button) => button.props['label'])).toEqual([
      'Terug naar berichten',
      'Meer opties',
    ])
  })

  it('styles with tokens only', () => {
    const css = readFileSync(new URL('./MobileReaderBar.css', import.meta.url), 'utf8')
    const values: string[] = []
    parse(css).walkDecls((declaration) => {
      values.push(declaration.value)
    })
    expect(values.filter((value) => /#[0-9a-f]{3,8}\b/i.test(value))).toEqual([])
  })

  it('keeps the text and icons readable on the bar and the button hover', () => {
    const value = tokens()
    const color = (name: string) => value.get(name) ?? ''
    for (const surface of ['--surface', '--surface-2']) {
      expect(contrastRatio(color('--ink'), color(surface))).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(color('--muted'), color(surface))).toBeGreaterThanOrEqual(4.5)
      // The icons are the buttons' only visible content: 3:1 as graphics.
      expect(contrastRatio(color('--ink-soft'), color(surface))).toBeGreaterThanOrEqual(3)
    }
  })
})
