import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { contrastRatio } from './contrast'
import { contrastPairs } from './contrast-pairs'

// Read the maintained token file itself; no values are copied into this test.
const css = readFileSync(new URL('../styles/tokens.css', import.meta.url), 'utf8')
const tokens = new Map(
  [...css.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map(([, name = '', value = '']) => [
    name,
    value.trim(),
  ]),
)

function token(name: string): string {
  const value = tokens.get(name)
  if (value === undefined) throw new Error(`${name} is not defined in tokens.css`)
  return value
}

describe('maintained token pairs', () => {
  it.each(contrastPairs)(
    '$foreground on $background reaches $minimum:1 ($use)',
    ({ foreground, background, minimum }) => {
      expect(contrastRatio(token(foreground), token(background))).toBeGreaterThanOrEqual(minimum)
    },
  )
})

describe('tokens.css', () => {
  it('declares custom properties on :root and nothing else', () => {
    const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '')
    const blocks = [...withoutComments.matchAll(/([^{}]+)\{([^}]*)\}/g)]
    expect(blocks.map(([, selector = '']) => selector.trim())).toEqual([':root'])
    const declarations = (blocks[0]?.[2] ?? '')
      .split(';')
      .map((declaration) => declaration.trim())
      .filter(Boolean)
    expect(declarations.filter((declaration) => !declaration.startsWith('--'))).toEqual([])
  })
})
