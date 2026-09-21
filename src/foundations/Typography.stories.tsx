import type { Meta, StoryObj } from '@storybook/react-vite'
import type { CSSProperties } from 'react'
import { Note, Page, Section, TokenName } from './specimen'

type Token = `--${string}`
type Role = Readonly<{
  name: string
  use: string
  font: Token
  tracking?: Token
  style?: CSSProperties
  sample: string
}>

const roles: readonly Role[] = [
  {
    name: 'Reader title',
    use: 'Subject above the message',
    font: '--text-reader-title',
    tracking: '--tracking-reader-title',
    sample: 'Can the delivery move up a week?',
  },
  {
    name: 'Queue title',
    use: 'Heading of the result list',
    font: '--text-queue-title',
    tracking: '--tracking-queue-title',
    sample: 'To review',
  },
  {
    name: 'Interface',
    use: 'Default text in product chrome',
    font: '--text-ui',
    sample: 'Showing results for all accounts',
  },
  {
    name: 'Control label',
    use: 'Sender, buttons, options',
    font: '--text-control',
    sample: 'Marit Vos',
  },
  {
    name: 'Metadata',
    use: 'Times, addresses; never lighter than --muted',
    font: '--text-meta',
    style: { color: 'var(--muted)' },
    sample: 'Today, 09:42',
  },
  {
    name: 'Overline',
    use: 'Group labels, uppercase, short',
    font: '--text-overline',
    tracking: '--tracking-overline',
    style: { color: 'var(--muted)', textTransform: 'uppercase' },
    sample: 'Workflow',
  },
]

function RoleRow({ role }: Readonly<{ role: Role }>) {
  const style: CSSProperties = {
    font: `var(${role.font})`,
    ...(role.tracking === undefined ? {} : { letterSpacing: `var(${role.tracking})` }),
    ...role.style,
  }
  return (
    <li className="fd-row">
      <span>
        <strong>{role.name}</strong>
        <br />
        <span className="fd-meta-text">{role.use}</span>
      </span>
      <p style={style}>{role.sample}</p>
      <span>
        <TokenName name={role.font} />
        {role.tracking === undefined ? null : <TokenName name={role.tracking} />}
      </span>
    </li>
  )
}

function TypographyPage() {
  return (
    <Page
      title="Typography"
      intro="One system UI family. Hierarchy comes from size, weight and space. Product chrome is dense; message text is larger and looser."
    >
      <Section title="Families" note="System fonts only. Nothing is downloaded or bundled.">
        <ul className="fd-rows">
          <li className="fd-row">
            <strong>Display and body</strong>
            <p style={{ fontFamily: 'var(--font-body)' }}>Spark Triage 0123456789</p>
            <TokenName name="--font-body" />
          </li>
          <li className="fd-row">
            <strong>Mono</strong>
            <p style={{ fontFamily: 'var(--font-mono)' }}>--accent 0123456789</p>
            <TokenName name="--font-mono" />
          </li>
        </ul>
      </Section>
      <Section title="Roles">
        <ul className="fd-rows">
          {roles.map((role) => (
            <RoleRow key={role.name} role={role} />
          ))}
        </ul>
      </Section>
      <Section
        title="Message body"
        note="16px with a 1.68 line height and a 730px measure. Message text never scrolls horizontally."
      >
        <div className="fd-rows">
          <p className="fd-message">
            Hi Wesley, after yesterday&rsquo;s meeting I took another look at the planning. The
            presentation to our board has moved up to Thursday 18 September. Could the first version
            of the proposal be ready on Monday 15 September? That would give us two days to collect
            comments.
          </p>
          <span>
            <TokenName name="--text-message" />
            <TokenName name="--measure-message" />
          </span>
        </div>
      </Section>
      <Section
        title="Tabular numbers"
        note="Counts and keyboard hints use tabular figures so columns of numbers line up."
      >
        <ul className="fd-rows">
          <li className="fd-row">
            <strong>Tabular</strong>
            <p className="fd-tabular">
              111 · 808
              <br />
              101 · 999
            </p>
            <code>font-variant-numeric: tabular-nums</code>
          </li>
          <li className="fd-row">
            <strong>Proportional</strong>
            <p>
              111 · 808
              <br />
              101 · 999
            </p>
            <code>normal</code>
          </li>
        </ul>
      </Section>
      <Section title="Notes">
        <Note label="Decision">
          Titles use weight 750. The source prototype set no weight, so its headings rendered at the
          browser default of 700.
        </Note>
        <Note label="Source">
          Control and metadata sizes come from the source type preview (13/20 at 700, 11/16);
          overlines come from its navigation labels (10px, 800, 0.08em). Overlines and metadata use{' '}
          <code>--muted</code>, never <code>--faint</code>.
        </Note>
        <Note label="Decision">
          Storybook and sample copy are English, like the rest of the repository.
        </Note>
      </Section>
    </Page>
  )
}

const meta = {
  title: 'Foundations/Typography',
  parameters: { layout: 'fullscreen' },
} satisfies Meta

export default meta

export const Specimens: StoryObj<typeof meta> = { render: () => <TypographyPage /> }
