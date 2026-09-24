import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'
import { MailboxReach } from './MailboxReach'

const meta = {
  title: 'Organisms/MailboxReach',
  component: MailboxReach,
  args: {
    selectedId: 'studio@mail.example',
    allLabel: 'All readable mailboxes',
    onSelect: fn(),
    onRetry: fn(),
    items: [
      {
        id: 'studio@mail.example',
        label: 'studio-noord@mail.example',
        account: 'studio',
        pages: 2,
        copies: 20,
        state: 'more',
        lastRead: { label: 'Last read 14:32', dateTime: '2026-09-24T12:32:00.000Z' },
      },
      {
        id: 'atelier@mail.example',
        label: 'atelier-linden@mail.example',
        account: 'atelier',
        pages: 2,
        copies: 18,
        state: 'complete',
        lastRead: { label: 'Last read 14:32', dateTime: '2026-09-24T12:32:00.000Z' },
      },
      {
        id: 'personal@mail.example',
        label: 'personal@mail.example',
        account: 'personal',
        pages: 1,
        copies: 10,
        state: 'failed',
      },
    ],
  },
  parameters: { layout: 'centered' },
  decorators: [
    (Story) => (
      <div style={{ width: 250, padding: 12, background: 'var(--surface)' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof MailboxReach>

export default meta
type Story = StoryObj<typeof meta>

/** Variant C: reach and failures stay in the rail while the queue remains compact. */
export const SelectedDirection: Story = {}

/** A later page failed, so earlier copies remain visible and only older reach retries. */
export const Incomplete: Story = {
  args: {
    items: [
      {
        id: 'studio@mail.example',
        label: 'studio-noord@mail.example',
        account: 'studio',
        pages: 2,
        copies: 20,
        state: 'incomplete',
        lastRead: { label: 'Last read 14:32', dateTime: '2026-09-24T12:32:00.000Z' },
      },
    ],
  },
}
