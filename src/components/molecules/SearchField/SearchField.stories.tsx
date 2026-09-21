import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState, type ComponentProps } from 'react'
import { SearchField } from './SearchField'

const meta = {
  title: 'Molecules/Search field',
  component: SearchField,
  args: {
    label: 'Search current results',
    placeholder: 'Search current results',
    shortcut: true,
    disabled: false,
  },
  argTypes: {
    label: { control: 'text' },
    placeholder: { control: 'text' },
    shortcut: { control: 'boolean' },
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
} satisfies Meta<typeof SearchField>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {}

// The caller owns the value. This story only echoes it.
function ControlledSearchField(args: ComponentProps<typeof SearchField>) {
  const [query, setQuery] = useState('invoice')
  return (
    <div style={{ display: 'grid', gap: 'var(--s2)' }}>
      <SearchField
        {...args}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value)
        }}
      />
      <output style={{ color: 'var(--muted)', font: 'var(--text-meta)' }}>
        Value: {JSON.stringify(query)}
      </output>
    </div>
  )
}

export const Controlled: Story = { render: (args) => <ControlledSearchField {...args} /> }

export const Disabled: Story = { args: { disabled: true } }

export const WithoutShortcut: Story = { args: { shortcut: false } }

// Below 240px the hint gives the placeholder its room back.
export const Narrow: Story = {
  decorators: [
    (Story) => (
      <div style={{ display: 'grid', gap: 'var(--s3)' }}>
        <div style={{ width: 280 }}>
          <Story />
        </div>
        <div style={{ width: 200 }}>
          <Story />
        </div>
      </div>
    ),
  ],
}
