import type { Meta, StoryObj } from '@storybook/react-vite'
import { SenderMeta } from './SenderMeta'

const meta = {
  title: 'Molecules/Sender meta',
  component: SenderMeta,
  args: {
    name: 'Marit Vos',
    initials: 'MV',
    address: 'marit.vos@example.com',
    account: { marker: 'studio', label: 'Studio Noord' },
    time: 'Today, 09:42',
    dateTime: '2026-09-21T09:42',
  },
  argTypes: {
    name: { control: 'text' },
    initials: { control: 'text' },
    address: { control: 'text' },
    toLabel: { control: 'text' },
    time: { control: 'text' },
    dateTime: { control: 'text' },
    className: { control: false },
  },
  // The reader's content column; the source's reading measure is 730px.
  render: (args) => (
    <div style={{ maxWidth: 730, padding: 'var(--s4)', background: 'var(--paper)' }}>
      <SenderMeta {...args} />
    </div>
  ),
} satisfies Meta<typeof SenderMeta>

export default meta

type Story = StoryObj<typeof meta>

/** The approved composition: avatar, name, address → mailbox, and the time on the right. */
export const Default: Story = {}

/** Without an address, only the mailbox is shown and nothing hidden is read. */
export const MailboxOnly: Story = { args: { address: undefined } }

export const OtherAccounts: Story = {
  argTypes: { account: { table: { disable: true } } },
  render: (args) => (
    <div
      style={{
        display: 'grid',
        gap: 'var(--s4)',
        maxWidth: 730,
        padding: 'var(--s4)',
        background: 'var(--paper)',
      }}
    >
      <SenderMeta {...args} />
      <SenderMeta
        {...args}
        name="Daan Kramer"
        initials="DK"
        address="daan@example.com"
        account={{ marker: 'atelier', label: 'Atelier Linden' }}
        time="Today, 08:17"
      />
      <SenderMeta
        {...args}
        name="Mila de Jong"
        initials="MJ"
        address="mila@example.com"
        account={{ marker: 'personal', label: 'Personal' }}
        time="Monday, 19:14"
      />
    </div>
  ),
}

/** The source's Dutch copy, with the hidden connector translated. */
export const Dutch: Story = {
  args: {
    address: 'marit.vos@voorbeeld.nl',
    toLabel: 'naar',
    time: 'Vandaag, 09:42',
  },
}

/** Long Dutch name, address, mailbox and time wrap instead of widening the reader. */
export const LongContent: Story = {
  args: {
    name: 'Gemeentelijke Belastingsamenwerking Rivierenland-Noordoostpolder, afdeling Vergunningen',
    initials: 'GB',
    address: 'noreply-vergunningen.omgevingsloket@belastingsamenwerking-rivierenland.nl',
    account: { marker: 'atelier', label: 'Architectenbureau Atelier Linden & Partners' },
    toLabel: 'naar',
    time: 'Gisteren, 16:26',
  },
}

/** A 280px column, narrower than any phone: the time moves under the text. */
export const NarrowWidth: Story = {
  args: { ...LongContent.args },
  render: (args) => (
    <div
      style={{
        width: 280,
        padding: 'var(--s4)',
        boxSizing: 'border-box',
        background: 'var(--paper)',
      }}
    >
      <SenderMeta {...args} />
    </div>
  ),
}

/** In place under a reader title, as in the source's reader header. */
export const InReaderHeader: Story = {
  render: (args) => (
    <header style={{ maxWidth: 730, padding: 'var(--s6)', background: 'var(--paper)' }}>
      <h2
        style={{ margin: '0 0 var(--s4)', font: 'var(--text-reader-title)', color: 'var(--ink)' }}
      >
        Can delivery move a week earlier?
      </h2>
      <SenderMeta {...args} />
    </header>
  ),
}
