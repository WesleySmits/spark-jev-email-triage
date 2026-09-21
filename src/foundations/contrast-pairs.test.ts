import { readFileSync } from 'node:fs'
import { parse } from 'postcss'
import { describe, expect, it } from 'vitest'
import { contrastRatio } from './contrast'
import { contrastPairs } from './contrast-pairs'

// Parse the maintained token file itself; no values are copied into this test.
const stylesheet = parse(readFileSync(new URL('../styles/tokens.css', import.meta.url), 'utf8'))
const tokens = new Map<string, string>()
stylesheet.walkDecls(/^--/, (declaration) => {
  tokens.set(declaration.prop, declaration.value)
})

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
    const nodes = stylesheet.nodes.filter((node) => node.type !== 'comment')
    expect(nodes.map((node) => (node.type === 'rule' ? node.selector : node.type))).toEqual([
      ':root',
    ])
    const declarations = nodes.flatMap((node) =>
      node.type === 'rule' ? node.nodes.filter((child) => child.type !== 'comment') : [],
    )
    const others = declarations.filter(
      (child) => child.type !== 'decl' || !child.prop.startsWith('--'),
    )
    expect(others.map((child) => child.toString())).toEqual([])
  })
})
