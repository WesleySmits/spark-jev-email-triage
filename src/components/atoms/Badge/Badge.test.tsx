import type { ReactElement } from 'react'
import { describe, expect, it } from 'vitest'
import { Badge } from './Badge'

type Element = ReactElement<{ className: string; children: string }, string>

describe('Badge', () => {
  it('shows its text in a neutral tag by default', () => {
    const element = Badge({ children: 'Invoice' }) as Element
    expect(element.type).toBe('span')
    expect(element.props).toEqual({ className: 'badge badge--neutral', children: 'Invoice' })
  })

  it.each(['review', 'done', 'danger'] as const)('applies the %s tone', (tone) => {
    expect((Badge({ tone, children: 'State' }) as Element).props.className).toBe(
      `badge badge--${tone}`,
    )
  })
})
