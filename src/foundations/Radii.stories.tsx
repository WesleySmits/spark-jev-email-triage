import type { Meta, StoryObj } from '@storybook/react-vite'
import { Page, Section, TokenName } from './specimen'

const radii = [
  {
    token: '--radius-control',
    alias: '--r1',
    name: 'Control',
    use: 'Controls, fields, panels',
  },
  { token: '--radius-frame', alias: '--r2', name: 'Frame', use: 'Larger preview frames only' },
  { token: '--radius-pill', alias: undefined, name: 'Pill', use: 'Compact tags only' },
] as const

function RadiiPage() {
  return (
    <Page
      title="Radii"
      intro="Small corners. No oversized radii; the pill shape is reserved for compact tags."
    >
      <Section title="Scale">
        <div className="fd-grid">
          {radii.map((radius) => (
            <article className="fd-tile" key={radius.token}>
              <div
                className="fd-shape"
                style={{
                  borderRadius: `var(${radius.token})`,
                  ...(radius.alias === undefined ? { height: 'var(--s8)' } : {}),
                }}
              />
              <strong>{radius.name}</strong>
              <span>{radius.use}</span>
              <TokenName name={radius.token} />
              {radius.alias === undefined ? null : <TokenName name={radius.alias} />}
            </article>
          ))}
        </div>
      </Section>
    </Page>
  )
}

const meta = {
  title: 'Foundations/Radii',
  parameters: { layout: 'fullscreen' },
} satisfies Meta

export default meta

export const Scale: StoryObj<typeof meta> = { render: () => <RadiiPage /> }
