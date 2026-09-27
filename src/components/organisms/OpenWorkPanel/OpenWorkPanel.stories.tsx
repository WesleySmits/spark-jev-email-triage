import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'
import { OpenWorkPanel, type OpenWorkSectionView } from './OpenWorkPanel'

// Fictional mail only: every address uses a reserved `.example` domain.
const reopen = { copy: { mailboxId: 'studio@mail.example', messageId: '14' } }

const sections: readonly OpenWorkSectionView[] = [
  {
    id: 'overdue',
    title: 'Overdue follow-up',
    count: '1',
    items: [
      {
        id: 'studio-11',
        title: 'Catalogue handover',
        source: 'studio@mail.example',
        decision: { label: 'Follow up later', tone: 'review' },
        standing: { label: 'Overdue', tone: 'danger' },
        saved: 'Saved by you on 20 Sep, 09:15 · due Fri 25 Sep',
        inbox: 'In Spark Inbox · unread',
        conflicts: [],
        rowId: 'row-studio-11',
      },
    ],
  },
  {
    id: 'open',
    title: 'Open work',
    count: '2',
    items: [
      {
        id: 'studio-12',
        title: 'Proof approval',
        source: 'studio@mail.example',
        decision: { label: 'Reply needed', tone: 'review' },
        standing: { label: 'Open', tone: 'review' },
        saved: 'Saved by you on 26 Sep, 14:02',
        inbox: 'In Spark Inbox · read',
        conflicts: [
          'Out of date: the thread has a newer version than the one this was saved for, so the work is open again. Decide again in the reader.',
        ],
        rowId: 'row-studio-12',
      },
      {
        id: 'alias-12',
        title: 'Message 12 (not in this reading)',
        source: 'alias@mail.example',
        decision: { label: 'Reply needed', tone: 'review' },
        standing: { label: 'Open', tone: 'review' },
        saved: 'Saved by you on 26 Sep, 14:03',
        inbox: 'Not in Spark Inbox · both views read completely',
        conflicts: [
          'No longer in the Spark Inbox, yet work is still saved as owed here. Nothing here moved it; decide again if it is finished.',
        ],
      },
    ],
  },
  {
    id: 'completed',
    title: 'Completed here',
    count: '1',
    items: [
      {
        id: 'studio-14',
        title: 'New appointment',
        source: 'studio@mail.example',
        decision: { label: 'Handled in Spark', tone: 'neutral' },
        standing: { label: 'Completed · your claim', tone: 'neutral' },
        saved: 'Saved by you on 24 Sep, 10:40',
        inbox: 'Spark Inbox unknown: the loaded reading may not reach it',
        conflicts: [
          'Not verified: this reading cannot confirm where this copy is or which version it holds.',
        ],
        reopen,
      },
    ],
  },
]

const header = {
  title: 'Open work',
  count: '2 open · 1 overdue · 1 completed',
  context: 'Counted from decisions saved in this app, per mailbox copy. Not a Spark Inbox count.',
}

const meta = {
  title: 'Organisms/Open work panel',
  component: OpenWorkPanel,
  args: { header, sections, onOpen: fn(), onReopen: fn() },
  argTypes: { className: { control: false } },
  // The queue column is 280 to 400px wide and bounded in height.
  render: (args) => (
    <div style={{ width: 400, height: 720 }}>
      <OpenWorkPanel {...args} />
    </div>
  ),
} satisfies Meta<typeof OpenWorkPanel>

export default meta

type Story = StoryObj<typeof meta>

/**
 * Overdue, open and completed work in their own sections, with the counts
 * sourced to this app. Conflicts are sentences: version drift, work owed on
 * mail that left the Inbox, and a completion this reading cannot verify.
 */
export const WithWork: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('heading', { level: 1, name: 'Open work' })).toBeVisible()
    await expect(canvas.getByText(/Not a Spark Inbox count/)).toBeVisible()
    for (const name of ['Overdue follow-up 1', 'Open work 2', 'Completed here 1']) {
      await expect(canvas.getByRole('heading', { level: 2, name })).toBeVisible()
    }
    // One delivery to an address and an alias stays two items.
    await expect(canvas.getByText('Mailbox: alias@mail.example')).toBeVisible()
    await expect(canvas.getAllByRole('list', { name: 'Conflicts' })).toHaveLength(3)
    await userEvent.click(
      canvas.getByRole('button', { name: 'Open in reader', description: 'Catalogue handover' }),
    )
    await expect(args.onOpen).toHaveBeenCalledWith('row-studio-11')
  },
}

/** Keyboard only: the reopen of a completed claim is reachable and named by its item. */
export const KeyboardReopen: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    const reopenButton = canvas.getByRole('button', {
      name: 'Reopen work',
      description: 'New appointment',
    })
    reopenButton.focus()
    await userEvent.keyboard('{Enter}')
    await expect(args.onReopen).toHaveBeenCalledWith('studio-14')
  },
}

/** A reopen being saved: its button says so and refuses a second press. */
export const Reopening: Story = {
  args: { busyId: 'studio-14', status: 'Reopening New appointment…' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('button', { name: 'Reopening…' })).toBeDisabled()
    await expect(canvas.getByRole('status')).toHaveTextContent('Reopening New appointment…')
  },
}

/** Nothing owed, some completed: the empty state points at them and not at the Inbox. */
export const NoOpenWork: Story = {
  args: {
    header: { ...header, count: '0 open · 0 overdue · 1 completed' },
    sections: sections.filter(({ id }) => id === 'completed'),
    empty: {
      title: 'No open work saved here',
      description:
        'Nothing saved in this app is still owed. Completed decisions are listed below. This says nothing about your Spark Inbox.',
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('heading', { name: 'No open work saved here' })).toBeVisible()
    await expect(canvas.getByRole('heading', { level: 2, name: 'Completed here 1' })).toBeVisible()
  },
}

/** Nothing was ever saved: distinct from an empty unread selection and an empty Inbox. */
export const NothingSaved: Story = {
  args: {
    header: { ...header, count: '0 open · 0 overdue · 0 completed' },
    sections: [],
    empty: {
      title: 'No open work saved here',
      description:
        'Nothing was saved as Reply needed, Follow up later or Handled in Spark in this app. This says nothing about your Spark Inbox.',
    },
  },
}

/** The record could not be read: never shown as an empty list. */
export const Unavailable: Story = {
  args: {
    header: { ...header, count: 'Not read' },
    sections: [],
    empty: {
      title: 'Open work could not be read',
      description:
        'The local work record did not answer, so nothing here is known. Your Spark Inbox is unaffected. Refresh to try again.',
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('heading', { name: 'Open work could not be read' })).toBeVisible()
    await expect(canvas.queryByRole('heading', { level: 2, name: /Open work \d/ })).toBeNull()
  },
}

/** A cut list says so under the counts. */
export const Bounded: Story = {
  args: {
    header: {
      ...header,
      note: 'Showing the most recently decided copies only; older ones are not listed.',
    },
  },
}

/** A phone: items wrap inside the pane and nothing overflows sideways. */
export const Phone: Story = {
  globals: { viewport: { value: 'phone390' } },
  render: (args) => (
    <div style={{ width: '100%', height: 720 }}>
      <OpenWorkPanel {...args} />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const body = canvasElement.querySelector('.open-work__body')
    await expect(body?.scrollWidth).toBeLessThanOrEqual(body?.clientWidth ?? 0)
  },
}
