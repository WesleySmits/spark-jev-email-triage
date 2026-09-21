import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'
import { ReaderActionBar } from './ReaderActionBar'

const meta = {
  title: 'Molecules/Reader action bar',
  component: ReaderActionBar,
  args: {
    primaryAction: { label: 'Archive', icon: 'check', shortcut: 'E', onClick: fn() },
    actions: [
      { label: 'Reply', shortcut: 'R', onClick: fn() },
      { label: 'Open in Spark', icon: 'external', disabled: true, onClick: fn() },
    ],
    note: { title: 'Local status', detail: 'Archived in this app; mailbox unchanged.' },
  },
  argTypes: {
    primaryAction: { control: 'object' },
    actions: { control: 'object' },
    note: { control: 'object' },
    className: { control: false },
  },
  // The source reader is flexible; 720px is a typical desktop width.
  render: (args) => (
    <div style={{ maxWidth: 720 }}>
      <ReaderActionBar {...args} />
    </div>
  ),
} satisfies Meta<typeof ReaderActionBar>

export default meta

type Story = StoryObj<typeof meta>

/**
 * The approved composition. Clicking a button logs its `onClick`; pressing the
 * shown keys does nothing here, because the caller handles them. Press Tab to
 * see the focus outline; the disabled action is skipped.
 */
export const Default: Story = {}

/** Only the primary action. */
export const PrimaryOnly: Story = { args: { actions: [], note: undefined } }

/** Without shortcut hints; `aria-keyshortcuts` is left out as well. */
export const WithoutShortcuts: Story = {
  args: {
    primaryAction: { label: 'Archive', icon: 'check', onClick: fn() },
    actions: [
      { label: 'Reply', onClick: fn() },
      { label: 'Snooze', icon: 'clock', variant: 'quiet', onClick: fn() },
    ],
  },
}

/** Disabled actions cannot be focused or activated and hide their shortcut. */
export const Disabled: Story = {
  args: {
    primaryAction: {
      label: 'Archive',
      icon: 'check',
      shortcut: 'E',
      disabled: true,
      onClick: fn(),
    },
    actions: [{ label: 'Reply', shortcut: 'R', disabled: true, onClick: fn() }],
    note: { title: 'Disconnected', detail: 'Actions return when Spark is connected.' },
  },
}

export const Dutch: Story = {
  args: {
    primaryAction: { label: 'Afhandelen', icon: 'check', shortcut: 'E', onClick: fn() },
    actions: [
      { label: 'Beantwoorden', shortcut: 'R', onClick: fn() },
      { label: 'Open in Spark', icon: 'external', disabled: true, onClick: fn() },
    ],
    note: { title: 'Lokale status', detail: 'Afgehandeld in deze app; mailbox ongewijzigd.' },
  },
}

/** Long Dutch labels wrap inside their buttons instead of widening the bar. */
export const LongLabels: Story = {
  args: {
    primaryAction: {
      label: 'Afhandelen en doorgaan naar het volgende bericht in de wachtrij',
      icon: 'check',
      shortcut: 'E',
      onClick: fn(),
    },
    actions: [
      { label: 'Beantwoorden aan alle ontvangers van dit gesprek', shortcut: 'R', onClick: fn() },
      { label: 'Later opnieuw tonen', icon: 'clock', variant: 'quiet', onClick: fn() },
    ],
    note: {
      title: 'Lokale status',
      detail:
        'Afgehandeld in deze app; de mailbox bij Spark blijft ongewijzigd tot synchronisatie.',
    },
  },
}

/**
 * A 320px reader, like a phone: the buttons share the width with a 44px
 * target and the note moves under them.
 */
export const Narrow: Story = {
  render: (args) => (
    <div style={{ width: 320 }}>
      <ReaderActionBar {...args} />
    </div>
  ),
}

/** In place at the bottom of a reader, which owns the scroll region above it. */
export const InReader: Story = {
  render: (args) => (
    <article
      style={{
        maxWidth: 720,
        display: 'grid',
        gridTemplateRows: 'minmax(0, 1fr) auto',
        height: 280,
        border: '1px solid var(--line)',
        background: 'var(--paper)',
      }}
    >
      <p style={{ margin: 0, padding: 'var(--s6)', color: 'var(--muted)', font: 'var(--text-ui)' }}>
        Message content goes here.
      </p>
      <ReaderActionBar {...args} />
    </article>
  ),
}
