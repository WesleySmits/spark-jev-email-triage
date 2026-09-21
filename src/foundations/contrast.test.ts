import { describe, expect, it } from 'vitest'
import { contrastRatio } from './contrast'

describe('contrastRatio', () => {
  it('spans 1:1 to 21:1', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5)
    expect(contrastRatio('#777777', '#777777')).toBe(1)
  })

  it('does not depend on argument order or hex case', () => {
    expect(contrastRatio('#FFFFFF', '#767676')).toBeCloseTo(contrastRatio('#767676', '#ffffff'), 10)
  })

  it('matches the WCAG reference for #767676 on white', () => {
    expect(contrastRatio('#767676', '#ffffff')).toBeCloseTo(4.54, 2)
  })

  it('reads the short form that minified CSS produces', () => {
    expect(contrastRatio('#fff', '#767676')).toBe(contrastRatio('#ffffff', '#767676'))
  })

  it('rejects values it cannot measure', () => {
    expect(() => contrastRatio('rgb(0 0 0)', '#ffffff')).toThrow('#rrggbb')
    expect(() => contrastRatio('#ffff', '#ffffff')).toThrow()
    expect(() => contrastRatio('', '#ffffff')).toThrow()
  })
})
