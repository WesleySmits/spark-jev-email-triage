import type { Meta, StoryObj } from '@storybook/react-vite'
import { Checkbox } from './Checkbox'

const meta = {
  title: 'Atoms/Checkbox',
  component: Checkbox,
  args: {
    label: 'Select visible results',
    hideLabel: false,
    indeterminate: false,
    disabled: false,
    defaultChecked: false,
  },
  argTypes: {
    label: { control: 'text' },
    hideLabel: { control: 'boolean' },
    indeterminate: { control: 'boolean' },
    disabled: { control: 'boolean' },
    defaultChecked: { control: 'boolean' },
  },
  // Remount when the initial state changes, so the control shows it.
  render: (args) => <Checkbox key={String(args.defaultChecked)} {...args} />,
} satisfies Meta<typeof Checkbox>

export default meta

type Story = StoryObj<typeof meta>

export const Unchecked: Story = {}

export const Checked: Story = { args: { defaultChecked: true } }

export const Indeterminate: Story = { args: { indeterminate: true } }

export const Disabled: Story = { args: { disabled: true } }

export const HiddenLabel: Story = {
  args: { label: 'Select Invoice March', hideLabel: true },
}

export const AllStates: Story = {
  render: () => (
    <div style={{ display: 'grid', justifyItems: 'start', font: 'var(--text-ui)' }}>
      <Checkbox label="Unchecked" />
      <Checkbox label="Checked" defaultChecked />
      <Checkbox label="Indeterminate" indeterminate />
      <Checkbox label="Disabled" disabled />
      <Checkbox label="Disabled and checked" disabled defaultChecked />
      <Checkbox label="Hidden label" hideLabel />
    </div>
  ),
}
