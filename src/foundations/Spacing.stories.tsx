import type { Meta, StoryObj } from '@storybook/react-vite'
import { Page, Section, TokenName } from './specimen'

// The source defines s1–s6 and s8. There is no s7; do not add one.
const steps = ['--s1', '--s2', '--s3', '--s4', '--s5', '--s6', '--s8'] as const

const usage = [
  { range: '8–12px', use: 'Dense navigation, tags and compact controls' },
  { range: '16–24px', use: 'Content panels and reading areas' },
  { range: '24–32px', use: 'Section breaks' },
] as const

function SpacingPage() {
  return (
    <Page
      title="Spacing"
      intro="A 4px base unit. Compact where people scan, roomier where they read and decide."
    >
      <Section title="Scale" note="The scale skips s7 on purpose. There is no 28px step.">
        <ul className="fd-rows">
          {steps.map((step) => (
            <li className="fd-row" key={step}>
              <code>{step}</code>
              <div className="fd-bar" style={{ width: `var(${step})` }} />
              <TokenName name={step} />
            </li>
          ))}
        </ul>
      </Section>
      <Section title="Use">
        <ul className="fd-rows">
          {usage.map((item) => (
            <li className="fd-row" key={item.range}>
              <strong>{item.range}</strong>
              <span>{item.use}</span>
            </li>
          ))}
        </ul>
      </Section>
    </Page>
  )
}

const meta = {
  title: 'Foundations/Spacing',
  parameters: { layout: 'fullscreen' },
} satisfies Meta

export default meta

export const Scale: StoryObj<typeof meta> = { render: () => <SpacingPage /> }
