import type { ReactElement } from 'react'
import { describe, expect, it } from 'vitest'
import { Avatar } from './Avatar'

type Element = ReactElement<Record<string, unknown>, string>

describe('Avatar', () => {
  it('is decorative without a label', () => {
    const { props } = Avatar({ initials: 'MV' }) as Element
    expect(props).toEqual({ className: 'avatar avatar--md', 'aria-hidden': true, children: 'MV' })
  })

  it('is a named image with a label', () => {
    const { props } = Avatar({
      initials: 'WS',
      label: 'Profile Wesley Smits',
      size: 'sm',
    }) as Element
    expect(props).toMatchObject({
      className: 'avatar avatar--sm',
      role: 'img',
      'aria-label': 'Profile Wesley Smits',
    })
    expect(props).not.toHaveProperty('aria-hidden')
  })
})
