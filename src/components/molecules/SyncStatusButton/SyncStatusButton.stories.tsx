import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState, type ComponentProps } from 'react'
import { fn } from 'storybook/test'
import { SyncStatusButton } from './SyncStatusButton'

const meta = {
  title: 'Molecules/Sync status button',
  component: SyncStatusButton,
  args: {
    status: 'connected',
    children: 'Updated 2 min ago',
    disabled: false,
    onClick: fn(),
  },
  argTypes: {
    status: {
      control: 'inline-radio',
      options: ['connected', 'disconnected', 'waiting', 'checking', 'idle'],
    },
    children: { control: 'text' },
    disabled: { control: 'boolean' },
  },
} satisfies Meta<typeof SyncStatusButton>

export default meta

type Story = StoryObj<typeof meta>

export const Connected: Story = {}

export const Disconnected: Story = {
  args: { status: 'disconnected', children: 'Disconnected · last sync 10:14' },
}

export const Disabled: Story = { args: { disabled: true } }

/** Waiting for Spark, expected back. Muted, not danger: nothing failed for good. */
export const Waiting: Story = {
  args: { status: 'waiting', children: 'Waiting for Spark · 09:41' },
}

/** A check runs now. */
export const Checking: Story = {
  args: { status: 'checking', children: 'Checking for Spark…' },
}

/** Not checked on its own, e.g. after an answer Spark couldn't give safely. */
export const Idle: Story = {
  args: { status: 'idle', children: 'Unexpected answer from Spark' },
}

// The caller owns the status. This story flips it on click, like the source's
// offline preview; nothing is synced.
function ToggleStory(args: ComponentProps<typeof SyncStatusButton>) {
  const [offline, setOffline] = useState(false)
  return (
    <SyncStatusButton
      {...args}
      status={offline ? 'disconnected' : 'connected'}
      onClick={() => {
        setOffline(!offline)
      }}
    >
      {offline ? 'Disconnected · last sync 10:14' : 'Updated 2 min ago'}
    </SyncStatusButton>
  )
}

export const CallerControlled: Story = {
  argTypes: { status: { table: { disable: true } }, children: { table: { disable: true } } },
  render: (args) => <ToggleStory {...args} />,
}

/** Pinned to the end of a top bar, as in the source. At 160px the text wraps. */
export const InTopBar: Story = {
  args: { status: 'disconnected', children: 'Disconnected · last sync 10:14' },
  render: (args) => (
    <div style={{ display: 'grid', gap: 'var(--s3)' }}>
      {[480, 320, 160].map((width) => (
        <div
          key={width}
          style={{
            width,
            minHeight: 48,
            boxSizing: 'border-box',
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--s4)',
            padding: '0 var(--s3)',
            border: '1px solid var(--line)',
            background: 'var(--surface)',
          }}
        >
          <SyncStatusButton {...args} style={{ marginLeft: 'auto' }} />
        </div>
      ))}
    </div>
  ),
}
