import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'
import { iconNames } from '../../atoms/Icon/Icon'
import { QueueHeader } from '../QueueHeader/QueueHeader'
import { EmptyState } from './EmptyState'

const meta = {
  title: 'Molecules/Empty state',
  component: EmptyState,
  args: {
    title: 'No results in this filter',
    description: 'Choose another queue or mailbox.',
    headingLevel: 2,
    icon: 'inbox',
    action: { label: 'Show all mailboxes', onClick: fn() },
  },
  argTypes: {
    title: { control: 'text' },
    description: { control: 'text' },
    headingLevel: { control: 'inline-radio', options: [2, 3, 4] },
    icon: { control: 'select', options: [undefined, ...iconNames] },
    action: { control: 'object' },
    titleId: { control: false },
    className: { control: false },
  },
  // The queue column in the source is about 330 to 400px wide, on --paper.
  render: (args) => (
    <div style={{ maxWidth: 400, background: 'var(--paper)' }}>
      <EmptyState {...args} />
    </div>
  ),
} satisfies Meta<typeof EmptyState>

export default meta

type Story = StoryObj<typeof meta>

/** An empty filtered queue, with one secondary next step. Clicking it logs `onClick`. */
export const Default: Story = {}

/** The source's composition: title and next step only, without icon or action. */
export const WithoutAction: Story = { args: { icon: undefined, action: undefined } }

/** The source's Dutch copy. */
export const Dutch: Story = {
  args: {
    title: 'Geen resultaten in deze filter',
    description: 'Kies een andere werkstroom of mailbox.',
    action: { label: 'Alle mailboxen tonen', onClick: fn() },
  },
}

/** A finished queue. Says what is done locally and where to go next, with a quiet action. */
export const QueueDone: Story = {
  args: {
    title: 'Nothing left to review',
    description: 'Every message in Needs review for all accounts is handled in this app.',
    icon: 'check',
    action: { label: 'Open Handled', variant: 'quiet', onClick: fn() },
  },
}

/** No search matches. The action carries a small decorative icon. */
export const NoSearchResults: Story = {
  args: {
    title: 'No messages match “factuur april”',
    description: 'Nothing in Needs review matches this search. Try other words or clear it.',
    icon: 'search',
    action: { label: 'Clear search', icon: 'undo', onClick: fn() },
  },
}

/** Long Dutch copy and action wrap within the column instead of widening it. */
export const LongCopy: Story = {
  args: {
    title:
      'Geen resultaten in Overheidscorrespondentie voor Architectenbureau Atelier Linden & Partners',
    description:
      'Deze filter combineert de werkstroom Te beoordelen met de mailbox administratie@gemeentelijkebelastingsamenwerkingrivierenland.nl. Kies een andere werkstroom of toon alle mailboxen.',
    action: { label: 'Alle mailboxen binnen deze werkstroom tonen', onClick: fn() },
  },
}

/** A 280px column, narrower than any phone: copy wraps and the action gets a 44px target. */
export const NarrowWidth: Story = {
  args: { ...LongCopy.args },
  render: (args) => (
    <div style={{ width: 280, background: 'var(--paper)' }}>
      <EmptyState {...args} />
    </div>
  ),
}

/** In place under a QueueHeader: the empty state's heading is one level below the queue's. */
export const InQueue: Story = {
  args: { ...Dutch.args, headingLevel: 3 },
  render: (args) => (
    <section aria-labelledby="queue-title" style={{ maxWidth: 400, background: 'var(--paper)' }}>
      <QueueHeader
        title="Te beoordelen"
        titleId="queue-title"
        count="0 resultaten"
        context="Studio · huidige filter"
      />
      <EmptyState {...args} />
    </section>
  ),
}
