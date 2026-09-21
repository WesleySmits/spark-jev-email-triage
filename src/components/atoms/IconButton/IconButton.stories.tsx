import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'
import { iconNames } from '../Icon/Icon'
import { IconButton } from './IconButton'

const meta = {
  title: 'Atoms/IconButton',
  component: IconButton,
  args: { icon: 'more', label: 'More options', variant: 'quiet', disabled: false, onClick: fn() },
  argTypes: {
    icon: { control: 'select', options: iconNames },
    label: { control: 'text' },
    variant: { control: 'inline-radio', options: ['quiet', 'secondary'] },
    disabled: { control: 'boolean' },
  },
} satisfies Meta<typeof IconButton>

export default meta
type Story = StoryObj<typeof meta>

export const Quiet: Story = {}

export const Secondary: Story = { args: { variant: 'secondary' } }

/** Disabled icon buttons cannot be focused or activated. */
export const Disabled: Story = { args: { disabled: true } }

/**
 * The source's mobile reader bar: back and more options. Press Tab to see the
 * focus outline on each button; the disabled one is skipped.
 */
export const Focus: Story = {
  render: () => (
    <div style={{ display: 'flex', gap: 'var(--s2)' }}>
      <IconButton icon="back" label="Back to messages" />
      <IconButton icon="more" label="More options" />
      <IconButton icon="undo" label="Undo" variant="secondary" />
      <IconButton icon="external" label="Open in Spark, not available" disabled />
    </div>
  ),
}
