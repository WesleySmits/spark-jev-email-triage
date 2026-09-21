import type { ReactElement } from 'react'
import { describe, expect, it } from 'vitest'
import { KeyboardHint } from './KeyboardHint'

describe('KeyboardHint', () => {
  it('marks the key up as keyboard input', () => {
    const element = KeyboardHint({ children: '/' }) as ReactElement<{ children: string }>
    expect(element.type).toBe('kbd')
    expect(element.props.children).toBe('/')
  })
})
