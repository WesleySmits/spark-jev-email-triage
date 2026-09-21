import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'
import { QueueHeader } from './QueueHeader'

const meta = {
  title: 'Molecules/Queue header',
  component: QueueHeader,
  args: {
    title: 'Needs review',
    headingLevel: 2,
    count: '3 results',
    context: 'All accounts · current filter',
  },
  argTypes: {
    title: { control: 'text' },
    headingLevel: { control: 'inline-radio', options: [1, 2, 3] },
    count: { control: 'text' },
    context: { control: 'text' },
    titleId: { control: false },
    className: { control: false },
  },
  // The queue column in the source is about 330 to 400px wide.
  render: (args) => (
    <div style={{ maxWidth: 400 }}>
      <QueueHeader {...args} />
    </div>
  ),
} satisfies Meta<typeof QueueHeader>

export default meta

type Story = StoryObj<typeof meta>

/** The approved composition: title, count and scope, without an action. */
export const Default: Story = {}

/** With one secondary action and a decorative icon. Clicking it logs `onClick`. */
export const WithAction: Story = {
  args: { action: { label: 'Complete selected', icon: 'check', onClick: fn() } },
}

export const QuietAction: Story = {
  args: { action: { label: 'Select all', variant: 'quiet', onClick: fn() } },
}

/** Disabled actions cannot be focused or activated. */
export const DisabledAction: Story = {
  args: { action: { label: 'Refresh', disabled: true, onClick: fn() } },
}

/** Without a context line. */
export const TitleAndCount: Story = { args: { context: undefined } }

/** The source's Dutch copy. */
export const Dutch: Story = {
  args: {
    title: 'Te beoordelen',
    count: '3 resultaten',
    context: 'Alle accounts · huidige filter',
    action: { label: 'Vernieuwen', onClick: fn() },
  },
}

/** Long Dutch title, count, context and action wrap instead of widening the column. */
export const LongCopy: Story = {
  args: {
    title: 'Overheidscorrespondentie die nog beoordeeld moet worden voor vrijdag',
    count: '1.284 resultaten binnen deze selectie',
    context:
      'Architectenbureau Atelier Linden & Partners · Gemeentelijke Belastingsamenwerking Rivierenland · huidige filter',
    action: { label: 'Alle zichtbare resultaten vernieuwen', onClick: fn() },
  },
}

/** A 280px column, narrower than any phone: the action moves under the text. */
export const NarrowWidth: Story = {
  args: { ...LongCopy.args },
  render: (args) => (
    <div style={{ width: 280 }}>
      <QueueHeader {...args} />
    </div>
  ),
}

/** In place above a list: the list is named by the heading through `titleId`. */
export const NamingAList: Story = {
  args: { titleId: 'queue-title', action: { label: 'Refresh', onClick: fn() } },
  render: (args) => (
    <section style={{ maxWidth: 400, background: 'var(--paper)' }}>
      <QueueHeader {...args} />
      <ul
        aria-labelledby="queue-title"
        style={{ margin: 0, padding: 'var(--s4)', color: 'var(--muted)', font: 'var(--text-ui)' }}
      >
        <li>Message rows go here.</li>
      </ul>
    </section>
  ),
}
