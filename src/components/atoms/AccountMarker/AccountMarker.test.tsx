import type { ReactElement } from 'react'
import { describe, expect, it } from 'vitest'
import { AccountMarker } from './AccountMarker'

describe('AccountMarker', () => {
  it.each(['studio', 'atelier', 'personal'] as const)(
    'marks the %s account decoratively',
    (account) => {
      const { props } = AccountMarker({ account }) as ReactElement<Record<string, unknown>>
      expect(props).toEqual({
        className: `account-marker account-marker--${account}`,
        'aria-hidden': true,
      })
    },
  )
})
