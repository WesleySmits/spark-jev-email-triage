import { readFileSync } from 'node:fs'
import { parse } from 'postcss'
import type { ReactElement } from 'react'
import { describe, expect, it } from 'vitest'
import { contrastRatio } from '../../../foundations/contrast'
import { Icon } from '../../atoms/Icon/Icon'
import { Brand } from './Brand'

type Element = ReactElement<Record<string, unknown>>

function render(props: Parameters<typeof Brand>[0] = {}) {
  const root = Brand(props) as Element
  const [mark, name] = root.props['children'] as [Element, Element | false]
  const icon = mark.props['children'] as Element
  return { root, mark, icon, name }
}

function tokens(): Map<string, string> {
  const values = new Map<string, string>()
  const file = readFileSync(new URL('../../../styles/tokens.css', import.meta.url), 'utf8')
  parse(file).walkDecls(/^--/, (declaration) => {
    values.set(declaration.prop, declaration.value)
  })
  return values
}

describe('Brand', () => {
  it('names itself with the visible wordmark and hides the glyph', () => {
    const { root, mark, icon, name } = render()
    expect(root.type).toBe('span')
    expect(root.props['className']).toBe('brand brand--md')
    expect(mark.props['className']).toBe('brand__mark')
    expect(icon.type).toBe(Icon)
    expect(icon.props).toEqual({ name: 'inbox', label: undefined })
    expect(name).toMatchObject({
      type: 'span',
      props: { className: 'brand__name', children: 'Spark Triage' },
    })
  })

  it('names the glyph when the wordmark is left out', () => {
    const { icon, name } = render({ wordmark: false, name: 'Spark Triage' })
    expect(name).toBe(false)
    expect(icon.props['label']).toBe('Spark Triage')
  })

  it('takes a size and extra classes', () => {
    expect(render({ size: 'sm', className: 'top-bar__brand' }).root.props['className']).toBe(
      'brand brand--sm top-bar__brand',
    )
  })

  it('styles with tokens only', () => {
    const css = readFileSync(new URL('./Brand.css', import.meta.url), 'utf8')
    const values: string[] = []
    parse(css).walkDecls((declaration) => {
      values.push(declaration.value)
    })
    expect(values.filter((value) => /#[0-9a-f]{3,8}\b/i.test(value))).toEqual([])
  })

  it('keeps the glyph and wordmark readable', () => {
    const value = tokens()
    const color = (name: string) => value.get(name) ?? ''
    // The glyph is a meaningful graphic: 3:1 on the mark's fill.
    expect(contrastRatio(color('--accent'), color('--accent-soft'))).toBeGreaterThanOrEqual(3)
    for (const surface of ['--paper', '--surface', '--surface-2']) {
      expect(contrastRatio(color('--ink'), color(surface))).toBeGreaterThanOrEqual(4.5)
    }
  })
})
