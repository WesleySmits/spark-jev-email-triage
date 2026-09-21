import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'
import { Button } from './Button'

const meta = {
  title: 'Atoms/Button',
  component: Button,
  args: { children: 'Save review', onClick: fn() },
} satisfies Meta<typeof Button>

export default meta
type Story = StoryObj<typeof meta>

export const Primary: Story = { args: { variant: 'primary' } }

export const Secondary: Story = { args: { variant: 'secondary', children: 'Skip' } }

export const Quiet: Story = { args: { variant: 'quiet', children: 'Cancel' } }

const variants = [
  ['primary', 'Primary'],
  ['secondary', 'Secondary'],
  ['quiet', 'Quiet'],
] as const

function Row({ disabled }: { disabled: boolean }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--s3)' }}>
      {variants.map(([variant, label]) => (
        <Button key={variant} variant={variant} disabled={disabled}>
          {label}
        </Button>
      ))}
    </div>
  )
}

/** Disabled buttons cannot be focused or activated. */
export const Disabled: Story = { render: () => <Row disabled /> }

/** Press Tab to see the focus outline on each variant. */
export const AllVariants: Story = {
  render: () => (
    <div style={{ display: 'grid', gap: 'var(--s4)' }}>
      <Row disabled={false} />
      <Row disabled />
    </div>
  ),
}
