import type { Meta, StoryObj } from '@storybook/react-vite'
import { SearchInput } from './SearchInput'

const meta = {
  title: 'Atoms/Search input',
  component: SearchInput,
  args: {
    label: 'Search current results',
    placeholder: 'Search current results',
    disabled: false,
  },
  argTypes: {
    label: { control: 'text' },
    placeholder: { control: 'text' },
    disabled: { control: 'boolean' },
  },
  // The source top bar gives the field at most 420px.
  decorators: [
    (Story) => (
      <div style={{ maxWidth: 420 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof SearchInput>

export default meta

type Story = StoryObj<typeof meta>

export const Empty: Story = {}

export const WithValue: Story = { args: { defaultValue: 'invoice' } }

export const Disabled: Story = { args: { disabled: true } }
