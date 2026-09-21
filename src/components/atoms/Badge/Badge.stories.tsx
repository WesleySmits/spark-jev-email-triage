import type { Meta, StoryObj } from '@storybook/react-vite'
import { Badge } from './Badge'

const meta = {
  title: 'Atoms/Badge',
  component: Badge,
  args: { tone: 'neutral', children: 'Invoice' },
  argTypes: {
    tone: { control: 'inline-radio', options: ['neutral', 'review', 'done'] },
    children: { control: 'text' },
  },
} satisfies Meta<typeof Badge>

export default meta

type Story = StoryObj<typeof meta>

export const Neutral: Story = {}

export const Review: Story = { args: { tone: 'review', children: 'Needs review' } }

export const Done: Story = { args: { tone: 'done', children: 'Done' } }

export const AllTones: Story = {
  argTypes: { tone: { table: { disable: true } }, children: { table: { disable: true } } },
  render: () => (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--s2)' }}>
      <Badge>Invoice</Badge>
      <Badge tone="review">Needs review</Badge>
      <Badge tone="done">Done</Badge>
    </div>
  ),
}
