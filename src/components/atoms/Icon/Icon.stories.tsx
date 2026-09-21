import type { Meta, StoryObj } from '@storybook/react-vite'
import { Icon, iconNames } from './Icon'

const meta = {
  title: 'Atoms/Icon',
  component: Icon,
  args: { name: 'inbox', size: 'md' },
  argTypes: {
    name: { control: 'select', options: iconNames },
    size: { control: 'inline-radio', options: ['md', 'sm'] },
    label: { control: 'text' },
  },
} satisfies Meta<typeof Icon>

export default meta

type Story = StoryObj<typeof meta>

export const Decorative: Story = {}

export const Labelled: Story = {
  args: { name: 'alert', label: 'Needs review' },
}

export const AllIcons: Story = {
  argTypes: { name: { table: { disable: true } } },
  render: ({ size }) => (
    <ul style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--s4)', margin: 0, padding: 0 }}>
      {iconNames.map((name) => (
        <li
          key={name}
          style={{ display: 'grid', justifyItems: 'center', gap: 'var(--s1)', listStyle: 'none' }}
        >
          <Icon name={name} size={size} />
          <code style={{ font: 'var(--text-meta)' }}>{name}</code>
        </li>
      ))}
    </ul>
  ),
}
