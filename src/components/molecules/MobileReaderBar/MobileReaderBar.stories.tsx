import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState, type ComponentProps } from 'react'
import { fn } from 'storybook/test'
import { MobileReaderBar } from './MobileReaderBar'

const meta = {
  title: 'Molecules/Mobile reader bar',
  component: MobileReaderBar,
  args: {
    title: 'Studio Noord',
    context: '1 of 3 in Needs review',
    backLabel: 'Back to messages',
    moreOptionsLabel: 'More options',
    onBack: fn(),
    onMoreOptions: fn(),
  },
  argTypes: {
    title: { control: 'text' },
    context: { control: 'text' },
    backLabel: { control: 'text' },
    moreOptionsLabel: { control: 'text' },
    moreOptionsExpanded: { control: 'boolean' },
    className: { control: false },
  },
  // The source's mobile reader is the full width of a phone, 600px at most.
  render: (args) => (
    <div style={{ maxWidth: 390 }}>
      <MobileReaderBar {...args} />
    </div>
  ),
} satisfies Meta<typeof MobileReaderBar>

export default meta

type Story = StoryObj<typeof meta>

/**
 * The approved bar: back, mailbox and position, more options. Press Tab to
 * move through both buttons. Clicking one logs its callback.
 */
export const Default: Story = {}

/** Without `onMoreOptions` the end slot stays empty and the text stays centered. */
export const BackOnly: Story = {
  argTypes: { moreOptionsLabel: { table: { disable: true } } },
  render: (args) => (
    <div style={{ maxWidth: 390 }}>
      <MobileReaderBar {...args} onMoreOptions={undefined} />
    </div>
  ),
}

/** Without a context line. */
export const TitleOnly: Story = { args: { context: undefined } }

/** The source's Dutch copy and button names. */
export const Dutch: Story = {
  args: {
    context: '1 van 3 te beoordelen',
    backLabel: 'Terug naar berichten',
    moreOptionsLabel: 'Meer opties',
  },
}

/** Long mailbox and position copy wraps; the bar grows and the buttons keep 44px. */
export const LongCopy: Story = {
  args: {
    title: 'Gemeentelijke Belastingsamenwerking Rivierenland',
    context: '1.284 van 12.906 berichten in Overheidscorrespondentie te beoordelen',
  },
}

/** A 240px column, narrower than any phone. Nothing scrolls sideways. */
export const NarrowWidth: Story = {
  args: { ...LongCopy.args },
  render: (args) => (
    <div style={{ width: 240 }}>
      <MobileReaderBar {...args} />
    </div>
  ),
}

// The caller owns what more options opens. This story toggles a stand-in panel
// and reflects it with `moreOptionsExpanded`; nothing else happens.
function MenuStory(args: ComponentProps<typeof MobileReaderBar>) {
  const [open, setOpen] = useState(false)
  return (
    <div style={{ maxWidth: 390 }}>
      <MobileReaderBar
        {...args}
        moreOptionsExpanded={open}
        onMoreOptions={() => {
          setOpen(!open)
        }}
      />
      {open && (
        <p
          style={{ margin: 0, padding: 'var(--s4)', color: 'var(--muted)', font: 'var(--text-ui)' }}
        >
          The caller's options go here.
        </p>
      )}
    </div>
  )
}

export const CallerControlledMenu: Story = {
  argTypes: { moreOptionsExpanded: { table: { disable: true } } },
  render: (args) => <MenuStory {...args} />,
}

/** Above the reader, as in the source: the reader's heading names the message. */
export const AboveTheReader: Story = {
  render: (args) => (
    <article style={{ maxWidth: 390, background: 'var(--paper)' }}>
      <MobileReaderBar {...args} />
      <div style={{ padding: 'var(--s4)', font: 'var(--text-ui)', color: 'var(--ink)' }}>
        <h2
          style={{
            margin: 0,
            font: 'var(--text-reader-title)',
            letterSpacing: 'var(--tracking-reader-title)',
          }}
        >
          Invoice March 2026
        </h2>
        <p style={{ margin: 'var(--s2) 0 0', color: 'var(--muted)' }}>Message content goes here.</p>
      </div>
    </article>
  ),
}
