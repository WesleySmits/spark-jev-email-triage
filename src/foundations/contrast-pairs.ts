// Token pairs that must meet WCAG contrast limits. Names only: the values come
// from src/styles/tokens.css. Shown in Foundations/Color and enforced by
// contrast-pairs.test.ts.

export type Token = `--${string}`

export type ContrastPair = Readonly<{
  foreground: Token
  background: Token
  /** 4.5 for readable text, 3 for control borders and focus outlines. */
  minimum: 3 | 4.5
  use: string
}>

const neutrals: readonly Token[] = ['--paper', '--surface', '--surface-2', '--canvas']
const controlBackgrounds: readonly Token[] = ['--paper', '--surface', '--surface-2']

function onEach(
  foreground: Token,
  backgrounds: readonly Token[],
  minimum: ContrastPair['minimum'],
  use: string,
): ContrastPair[] {
  return backgrounds.map((background) => ({ foreground, background, minimum, use }))
}

export const contrastPairs: readonly ContrastPair[] = [
  ...onEach('--ink', ['--paper', '--canvas'], 4.5, 'Primary text'),
  { foreground: '--ink-soft', background: '--paper', minimum: 4.5, use: 'Subjects' },
  { foreground: '--ink-soft', background: '--surface', minimum: 4.5, use: 'Reader action note' },
  ...onEach('--muted', [...neutrals, '--accent-soft'], 4.5, 'Secondary text'),
  { foreground: '--accent', background: '--paper', minimum: 4.5, use: 'Links' },
  ...onEach('--paper', ['--accent', '--accent-dark'], 4.5, 'Primary action'),
  { foreground: '--accent-ink', background: '--accent-soft', minimum: 4.5, use: 'Selected item' },
  { foreground: '--attention', background: '--attention-soft', minimum: 4.5, use: 'Review' },
  { foreground: '--success', background: '--success-soft', minimum: 4.5, use: 'Completed' },
  { foreground: '--danger', background: '--danger-soft', minimum: 4.5, use: 'Disconnected' },
  ...onEach('--danger', controlBackgrounds, 4.5, 'Disconnected status text'),
  ...onEach('--border-control', controlBackgrounds, 3, 'Control border'),
  ...onEach('--focus', [...controlBackgrounds, '--canvas', '--accent-soft'], 3, 'Focus outline'),
]
