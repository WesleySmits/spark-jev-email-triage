import type { Meta, StoryObj } from '@storybook/react-vite'
import { Page, Section, TokenName } from './specimen'

function ElevationPage() {
  return (
    <Page
      title="Borders and elevation"
      intro="Prefer edges over elevation. Dividers and surface shifts structure the workspace; shadows are reserved for the outer shell and transient feedback."
    >
      <Section
        title="Borders"
        note="1px lines. Dividers and frames are decorative; borders of interactive controls use --border-control. Don't stack cards inside cards."
      >
        <ul className="fd-rows">
          <li className="fd-row">
            <strong>Decorative divider</strong>
            <div className="fd-divider" style={{ borderColor: 'var(--line)' }} />
            <TokenName name="--line" />
          </li>
          <li className="fd-row">
            <strong>Decorative frame</strong>
            <div className="fd-divider" style={{ borderColor: 'var(--line-strong)' }} />
            <TokenName name="--line-strong" />
          </li>
          <li className="fd-row">
            <strong>Control border</strong>
            <div className="fd-divider" style={{ borderColor: 'var(--border-control)' }} />
            <TokenName name="--border-control" />
          </li>
        </ul>
      </Section>
      <Section
        title="Selection marker"
        note="Selection pairs a 3px inset accent rule with a tinted surface and stronger text. It never relies on color or shadow alone."
      >
        <div className="fd-grid">
          <div className="fd-selected">Selected</div>
        </div>
      </Section>
      <Section title="Shadows" note="Two shadows only.">
        <div className="fd-stage">
          <div className="fd-grid">
            <article className="fd-lift" style={{ boxShadow: 'var(--shadow-shell)' }}>
              <strong>Shell</strong>
              <p className="fd-meta-text">The single outer work surface</p>
              <TokenName name="--shadow-shell" />
            </article>
            <article
              className="fd-lift"
              style={{
                boxShadow: 'var(--shadow-toast)',
                borderColor: 'var(--success-line)',
                borderRadius: 'var(--radius-control)',
              }}
            >
              <strong>Toast</strong>
              <p className="fd-meta-text">Transient feedback</p>
              <TokenName name="--shadow-toast" />
            </article>
          </div>
        </div>
      </Section>
    </Page>
  )
}

const meta = {
  title: 'Foundations/Borders and elevation',
  parameters: { layout: 'fullscreen' },
} satisfies Meta

export default meta

export const Overview: StoryObj<typeof meta> = { render: () => <ElevationPage /> }
