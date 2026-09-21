import type { Meta, StoryObj } from '@storybook/react-vite'
import { AccountMarker } from './AccountMarker'

const meta = {
  title: 'Atoms/Account marker',
  component: AccountMarker,
  args: { account: 'studio' },
  argTypes: {
    account: { control: 'inline-radio', options: ['studio', 'atelier', 'personal'] },
  },
} satisfies Meta<typeof AccountMarker>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const WithAccountNames: Story = {
  argTypes: { account: { table: { disable: true } } },
  render: () => (
    <ul
      style={{ display: 'grid', gap: 'var(--s2)', margin: 0, padding: 0, font: 'var(--text-ui)' }}
    >
      {(
        [
          ['studio', 'Studio Noord'],
          ['atelier', 'Atelier Linden'],
          ['personal', 'Personal'],
        ] as const
      ).map(([account, name]) => (
        <li
          key={account}
          style={{ display: 'flex', alignItems: 'center', gap: 'var(--s2)', listStyle: 'none' }}
        >
          <AccountMarker account={account} />
          {name}
        </li>
      ))}
    </ul>
  ),
}
