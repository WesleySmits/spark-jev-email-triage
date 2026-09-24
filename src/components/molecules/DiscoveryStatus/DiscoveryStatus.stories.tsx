import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'
import { DiscoveryStatus } from './DiscoveryStatus'

const meta = {
  title: 'Molecules/DiscoveryStatus',
  component: DiscoveryStatus,
  args: {
    loading: false,
    onContinue: fn(),
    scope: {
      view: 'unread',
      query: 'cedar',
      fields: ['sender', 'subject'],
      valuesMayBeTruncated: true,
      pageSize: 10,
      cursor: '11111111-1111-4111-8111-111111111111',
      mailboxes: [
        {
          id: 'studio-noord@mail.example',
          label: 'studio-noord@mail.example',
          pages: 2,
          scanned: 20,
          matched: 2,
          bounded: true,
        },
        {
          id: 'atelier-linden@mail.example',
          label: 'atelier-linden@mail.example',
          pages: 2,
          scanned: 18,
          matched: 1,
          bounded: false,
        },
      ],
      failed: [],
      incomplete: [],
      readable: 2,
      scanned: 38,
      matched: 3,
      bounded: true,
      searchedAt: '14:32',
      searchCompletedAt: '2026-09-24T12:32:00.000Z',
    },
  },
  decorators: [
    (Story) => (
      <div style={{ width: 420, padding: 16, background: 'var(--surface)' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof DiscoveryStatus>

export default meta
type Story = StoryObj<typeof meta>

/** Variant C keeps the queue summary brief while detailed reach stays in the rail. */
export const Bounded: Story = {}

export const Partial: Story = {
  args: {
    scope: {
      ...meta.args.scope,
      failed: [
        {
          id: 'personal@mail.example',
          label: 'personal@mail.example',
          reason: 'failed',
        },
      ],
    },
  },
}
