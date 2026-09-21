import type { Meta, StoryObj } from '@storybook/react-vite'
import { StatusDot } from './StatusDot'

const meta = {
  title: 'Atoms/Status dot',
  component: StatusDot,
  args: { tone: 'success' },
  argTypes: {
    tone: { control: 'inline-radio', options: ['success', 'danger'] },
    label: { control: 'text' },
  },
} satisfies Meta<typeof StatusDot>

export default meta

type Story = StoryObj<typeof meta>

export const Success: Story = {}

export const Danger: Story = { args: { tone: 'danger' } }

export const WithStatusText: Story = {
  argTypes: { tone: { table: { disable: true } }, label: { table: { disable: true } } },
  render: () => (
    <ul
      style={{
        display: 'grid',
        gap: 'var(--s3)',
        margin: 0,
        padding: 0,
        font: '400 12px / 16px var(--font-body)',
      }}
    >
      {(
        [
          ['success', 'var(--muted)', 'Updated 2 min ago'],
          ['danger', 'var(--danger)', 'Disconnected · last sync 10:14'],
        ] as const
      ).map(([tone, color, text]) => (
        <li
          key={tone}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--s2)',
            color,
            listStyle: 'none',
          }}
        >
          <StatusDot tone={tone} />
          {text}
        </li>
      ))}
    </ul>
  ),
}
