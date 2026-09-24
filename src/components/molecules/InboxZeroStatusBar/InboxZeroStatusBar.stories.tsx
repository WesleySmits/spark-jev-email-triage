import type { Meta, StoryObj } from '@storybook/react-vite'
import { failedCoverage, inboxCoverage, viewCoverage } from '../../../app/inbox-coverage'
import { InboxZeroStatusBar } from './InboxZeroStatusBar'

const view = (kind: 'unread' | 'other', loaded = 0, bounded = false) =>
  viewCoverage({
    view: kind,
    mailboxes: [{ id: 'studio@mail.example', label: 'Studio mailbox', loaded, bounded }],
    failed: [],
    incomplete: [],
    readable: 1,
    loaded,
    bounded,
    startedAt: '2026-09-24T09:42:00.000Z',
    refreshedAt: kind === 'unread' ? '2026-09-24T09:43:00.000Z' : '2026-09-24T09:44:00.000Z',
  })

const incomplete = inboxCoverage(inboxCoverage(undefined, view('unread')), view('other', 23, true))
const confirmed = inboxCoverage(inboxCoverage(undefined, view('unread')), view('other'))
const failed = inboxCoverage(
  inboxCoverage(undefined, view('unread')),
  failedCoverage('other', '2026-09-24T09:44:00.000Z', '2026-09-24T09:45:00.000Z'),
)

const meta = {
  title: 'Molecules/Inbox Zero status bar',
  component: InboxZeroStatusBar,
  args: { coverage: incomplete },
  render: (args) => (
    <div style={{ width: 'min(100%, 400px)', padding: 16, background: 'var(--paper)' }}>
      <InboxZeroStatusBar {...args} />
    </div>
  ),
} satisfies Meta<typeof InboxZeroStatusBar>

export default meta
type Story = StoryObj<typeof meta>

export const Incomplete: Story = {}
export const Confirmed: Story = { args: { coverage: confirmed } }
export const Failed: Story = { args: { coverage: failed } }
export const Mobile: Story = {
  render: (args) => (
    <div style={{ width: 320, padding: 8, background: 'var(--paper)' }}>
      <InboxZeroStatusBar {...args} />
    </div>
  ),
}
