import type { ReactElement, SVGProps } from 'react'
import { describe, expect, it } from 'vitest'
import { Icon, iconNames } from './Icon'

type Svg = ReactElement<SVGProps<SVGSVGElement> & Record<string, unknown>>

function svg(element: ReactElement): Svg['props'] {
  return (element as Svg).props
}

describe('Icon', () => {
  it('is hidden from assistive technology without a label', () => {
    const props = svg(Icon({ name: 'check' }))
    expect(props['aria-hidden']).toBe(true)
    expect(props.role).toBeUndefined()
  })

  it('is a named image with a label', () => {
    const props = svg(Icon({ name: 'alert', label: 'Needs review' }))
    expect(props.role).toBe('img')
    expect(props['aria-label']).toBe('Needs review')
    expect(props['aria-hidden']).toBeUndefined()
  })

  it('sizes through a class', () => {
    expect(svg(Icon({ name: 'search', size: 'sm' })).className).toBe('icon icon--sm')
    expect(svg(Icon({ name: 'search' })).className).toBe('icon icon--md')
  })

  it('draws every icon from the selected direction', () => {
    expect(iconNames).toEqual([
      'inbox',
      'check',
      'clock',
      'alert',
      'search',
      'external',
      'back',
      'more',
      'chevron',
      'undo',
    ])
    for (const name of iconNames) {
      expect(svg(Icon({ name })).children).toBeTruthy()
    }
  })
})
