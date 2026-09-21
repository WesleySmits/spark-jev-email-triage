import type { ReactElement } from 'react'
import { describe, expect, it } from 'vitest'
import { StatusDot } from './StatusDot'

type Element = ReactElement<Record<string, unknown>, string>

describe('StatusDot', () => {
  it('is a decorative success dot by default', () => {
    const element = StatusDot({}) as Element
    expect(element.type).toBe('span')
    expect(element.props).toEqual({
      className: 'status-dot status-dot--success',
      'aria-hidden': true,
    })
  })

  it('applies the danger tone', () => {
    expect((StatusDot({ tone: 'danger' }) as Element).props['className']).toBe(
      'status-dot status-dot--danger',
    )
  })

  it('is a named image with a label', () => {
    const { props } = StatusDot({ tone: 'danger', label: 'Disconnected' }) as Element
    expect(props['role']).toBe('img')
    expect(props['aria-label']).toBe('Disconnected')
    expect(props['aria-hidden']).toBeUndefined()
  })
})
