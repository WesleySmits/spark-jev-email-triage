import type { Meta, StoryObj } from '@storybook/react-vite'
import { useId } from 'react'
import { contrastRatio } from './contrast'
import { contrastPairs, type ContrastPair, type Token } from './contrast-pairs'
import { Note, Page, Section, TokenName, useToken } from './specimen'

type Swatch = Readonly<{ token: Token; name: string; use: string }>

const surfaces: readonly Swatch[] = [
  { token: '--canvas', name: 'Canvas', use: 'Surround behind the app shell' },
  { token: '--paper', name: 'Paper', use: 'Reader and list surfaces' },
  { token: '--surface', name: 'Surface', use: 'Sidebar and quiet toolbars' },
  { token: '--surface-2', name: 'Surface 2', use: 'Exported; no documented use yet' },
]

const text: readonly Swatch[] = [
  { token: '--ink', name: 'Ink', use: 'Primary text' },
  { token: '--ink-soft', name: 'Ink soft', use: 'Subjects and secondary strong text' },
  { token: '--muted', name: 'Muted', use: 'Secondary labels and metadata' },
  { token: '--faint', name: 'Faint', use: 'Decorative only, never readable text' },
]

const borders: readonly Swatch[] = [
  { token: '--line', name: 'Line', use: 'Decorative dividers' },
  { token: '--line-strong', name: 'Line strong', use: 'Decorative frames' },
  { token: '--border-control', name: 'Border control', use: 'Fields, buttons, marks, hints' },
]

const accent: readonly Swatch[] = [
  { token: '--accent', name: 'Accent', use: 'Selection and primary action' },
  { token: '--accent-dark', name: 'Accent dark', use: 'Strong primary action and hover' },
  { token: '--accent-soft', name: 'Accent soft', use: 'Selected surface' },
  { token: '--accent-ink', name: 'Accent ink', use: 'Text on a selected surface' },
]

const accounts: readonly Swatch[] = [
  { token: '--account-studio', name: 'Studio', use: '8px account marker' },
  { token: '--account-atelier', name: 'Atelier', use: '8px account marker' },
  { token: '--account-personal', name: 'Personal', use: '8px account marker' },
]

type StateSet = Readonly<{ name: string; use: string; text: Token; fill: Token; line?: Token }>

// Danger has no line token; its border is the text color (decided).
const states: readonly StateSet[] = [
  {
    name: 'Review',
    use: 'Uncertain classification',
    text: '--attention',
    fill: '--attention-soft',
    line: '--attention-line',
  },
  {
    name: 'Completed',
    use: 'Completed state and confirmation',
    text: '--success',
    fill: '--success-soft',
    line: '--success-line',
  },
  { name: 'Disconnected', use: 'Offline or failed', text: '--danger', fill: '--danger-soft' },
]

function SwatchGrid({ swatches }: Readonly<{ swatches: readonly Swatch[] }>) {
  return (
    <div className="fd-grid">
      {swatches.map((swatch) => (
        <article className="fd-tile" key={swatch.token}>
          <div className="fd-swatch" style={{ background: `var(${swatch.token})` }} />
          <strong>{swatch.name}</strong>
          <span>{swatch.use}</span>
          <TokenName name={swatch.token} />
        </article>
      ))}
    </div>
  )
}

function StateTile({ state }: Readonly<{ state: StateSet }>) {
  const line = state.line ?? state.text
  return (
    <article className="fd-tile">
      <div
        className="fd-state"
        style={{
          color: `var(${state.text})`,
          background: `var(${state.fill})`,
          borderColor: `var(${line})`,
        }}
      >
        {state.name}
      </div>
      <span>{state.use}</span>
      <TokenName name={state.text} />
      <TokenName name={state.fill} />
      {state.line === undefined ? null : <TokenName name={state.line} />}
    </article>
  )
}

/** Measured ratio text and verdict, or a notice when a value can't be read. */
function assess(foreground: string, background: string, minimum: number) {
  try {
    const ratio = contrastRatio(foreground, background)
    return { ratio: `${ratio.toFixed(2)}:1`, passes: ratio >= minimum }
  } catch {
    return { ratio: 'Not measurable', passes: false }
  }
}

function PairSample({ pair }: Readonly<{ pair: ContrastPair }>) {
  const background = `var(${pair.background})`
  if (pair.minimum === 3) {
    return (
      <span
        className="fd-pair fd-pair-edge"
        style={{ borderColor: `var(${pair.foreground})`, background }}
      >
        Edge
      </span>
    )
  }
  return (
    <span className="fd-pair" style={{ color: `var(${pair.foreground})`, background }}>
      Aa text
    </span>
  )
}

function PairRow({ pair }: Readonly<{ pair: ContrastPair }>) {
  const { ratio, passes } = assess(
    useToken(pair.foreground),
    useToken(pair.background),
    pair.minimum,
  )
  return (
    <tr>
      <td>
        <PairSample pair={pair} />
      </td>
      <td>
        <code>{pair.foreground}</code> on <code>{pair.background}</code>
      </td>
      <td>{pair.use}</td>
      <td>{ratio}</td>
      <td>
        {pair.minimum}:1 {passes ? 'Pass' : <strong>Fails</strong>}
      </td>
    </tr>
  )
}

function PairTable() {
  const captionId = useId()
  return (
    <div className="fd-table-wrap" role="region" aria-labelledby={captionId} tabIndex={0}>
      <table className="fd-table">
        <caption id={captionId}>Measured contrast pairs</caption>
        <thead>
          <tr>
            <th scope="col">Sample</th>
            <th scope="col">Pair</th>
            <th scope="col">Use</th>
            <th scope="col">Ratio</th>
            <th scope="col">Minimum</th>
          </tr>
        </thead>
        <tbody>
          {contrastPairs.map((pair) => (
            <PairRow key={`${pair.foreground} ${pair.background}`} pair={pair} />
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ColorsPage() {
  return (
    <Page
      title="Color"
      intro="Cool neutral surfaces with one restrained indigo accent. Amber, green and red appear only for review, completion and failure, and always with a label, border or structural change."
    >
      <Section title="Surfaces">
        <SwatchGrid swatches={surfaces} />
      </Section>
      <Section title="Text">
        <SwatchGrid swatches={text} />
      </Section>
      <Section title="Borders">
        <SwatchGrid swatches={borders} />
      </Section>
      <Section title="Accent" note="Only one accent dominates a screen.">
        <SwatchGrid swatches={accent} />
      </Section>
      <Section
        title="State sets"
        note="Text, fill and line are used together as one matched set. Never use a state color on its own."
      >
        <div className="fd-grid">
          {states.map((state) => (
            <StateTile key={state.name} state={state} />
          ))}
        </div>
        <Note label="Decision">
          Danger has no <code>--danger-line</code>; its border is <code>--danger</code>.
        </Note>
      </Section>
      <Section title="Account markers" note="Small 8px markers only, never large fills.">
        <ul className="fd-rows">
          {accounts.map((account) => (
            <li className="fd-row" key={account.token}>
              <span>
                <span className="fd-marker" style={{ background: `var(${account.token})` }} />
                {account.name}
              </span>
              <span>{account.use}</span>
              <TokenName name={account.token} />
            </li>
          ))}
        </ul>
      </Section>
      <Section
        title="Measured pairs"
        note="Ratios are computed in the browser from the tokens. Text needs 4.5:1; control borders and focus outlines need 3:1 against their surface. The same pairs are enforced by a unit test."
      >
        <PairTable />
        <Note label="Decision">
          <code>--muted</code> was darkened within its hue so it reaches 4.5:1 on every neutral
          surface, <code>--canvas</code> included. <code>--faint</code> is decorative only and is
          not measured as text.
        </Note>
        <Note label="Decision">
          <code>--line</code> and <code>--line-strong</code> stay light for decorative dividers.
          Control borders use <code>--border-control</code>, which reaches 3:1 on paper, surface and
          surface 2.
        </Note>
      </Section>
    </Page>
  )
}

const meta = {
  title: 'Foundations/Color',
  parameters: { layout: 'fullscreen' },
} satisfies Meta

export default meta

export const Palette: StoryObj<typeof meta> = { render: () => <ColorsPage /> }
