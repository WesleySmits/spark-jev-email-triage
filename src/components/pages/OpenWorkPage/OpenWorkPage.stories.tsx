import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'
import { decideFollowUp } from '../../../domain/follow-up'
import type { WorkDecisionRequest, WorkMessageRead } from '../../../app/open-work'
import { openWorkList, openWorkTally } from '../../../domain/open-work'
import { OpenWorkPage } from './OpenWorkPage'

const now = '2026-09-27T09:00:00.000Z'
const copy = { mailboxId: 'studio@example.test', messageId: 'message-1' }
const decision = decideFollowUp({
  target: { copy, threadId: 'thread-1', latestMessageId: 'message-1' },
  kind: 'reply_needed',
  dueAt: '2026-09-26T09:00:00.000Z',
  decidedBy: 'local',
  decidedAt: '2026-09-25T09:00:00.000Z',
})
const items = openWorkList(
  [
    {
      copy,
      decisions: [decision],
      evidence: { reach: 'listed', view: 'unread' },
      observation: {
        copy,
        observed: 'named',
        threadId: 'thread-1',
        latestMessageId: 'message-1',
        proven: true,
      },
    },
  ],
  now,
)
const completedItems = openWorkList(
  [
    {
      copy,
      decisions: [
        decideFollowUp({
          target: decision.target,
          kind: 'handled_in_spark',
          dueAt: null,
          decidedBy: 'local',
          decidedAt: now,
        }),
      ],
      evidence: { reach: 'read_completely' },
      observation: {
        copy,
        observed: 'named',
        threadId: 'thread-1',
        latestMessageId: 'message-1',
        proven: true,
      },
    },
  ],
  now,
)
const selectedMessage: WorkMessageRead = {
  status: 'ready',
  target: decision.target,
  subject: 'Proposal for the autumn launch',
  messages: [
    {
      id: 'message-1',
      sender: 'Marit van Dijk <marit@example.test>',
      sentAt: now,
      text: 'Hi Wesley,\n\nCould you review the draft proposal and send your feedback before we schedule the launch?\n\nThanks,\nMarit',
    },
  ],
}

const meta = {
  title: 'Pages/OpenWorkPage',
  component: OpenWorkPage,
  args: {
    mode: 'work',
    reading: {
      status: 'ready',
      items,
      tally: openWorkTally(items),
      bounded: false,
      checkedAt: now,
    },
    loading: false,
    onRefresh: fn(),
    onRecord: fn(() => Promise.resolve({ status: 'recorded' as const })),
    onRead: fn((): Promise<WorkMessageRead> => Promise.resolve({ status: 'unavailable' })),
  },
} satisfies Meta<typeof OpenWorkPage>

export default meta
type Story = StoryObj<typeof meta>
export const Overdue: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText(/1 overdue/)).toBeVisible()
    await expect(canvas.getByText(/Inbox: in inbox/)).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'I handled this in Spark' }))
    await expect(args.onRecord).toHaveBeenCalledOnce()
    await expect(canvas.getByText(/claim saved locally/)).toBeVisible()
  },
}
export const NoRecordedWork: Story = {
  args: {
    reading: {
      status: 'ready',
      items: [],
      tally: openWorkTally([]),
      bounded: false,
      checkedAt: now,
    },
  },
}

export const Completed: Story = {
  args: {
    mode: 'completed',
    reading: {
      status: 'ready',
      items: completedItems,
      tally: openWorkTally(completedItems),
      bounded: false,
      checkedAt: now,
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByRole('heading', { name: 'Completed decisions', level: 1 }),
    ).toBeVisible()
    await expect(canvas.getByText(/1 completed/)).toBeVisible()
    await expect(canvas.queryByRole('heading', { name: /Overdue/ })).not.toBeInTheDocument()
  },
}

export const SelectedReader: Story = {
  args: {
    onRead: fn(() => Promise.resolve(selectedMessage)),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Read current thread' }))
    await expect(
      await canvas.findByRole('heading', { name: 'Proposal for the autumn launch' }),
    ).toBeVisible()
    await expect(canvas.getByRole('group', { name: 'Record work for this version' })).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Read current thread' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  },
}

const versionSave = fn((request: WorkDecisionRequest) => {
  if (!request.requestId) throw new Error('A save needs a request id')
  return Promise.resolve({ status: 'recorded' as const })
})

export const VersionChanged: Story = {
  args: {
    onRecord: versionSave,
    onRead: fn((): Promise<WorkMessageRead> =>
      Promise.resolve({
        status: 'ready' as const,
        target: { copy, threadId: 'thread-1', latestMessageId: 'message-2' },
        subject: 'A new reply arrived',
        messages: [
          { id: 'message-1', sender: 'Marit', sentAt: now, text: 'Could you reply?' },
          { id: 'message-2', sender: 'Marit', sentAt: now, text: 'Following up.' },
        ],
      }),
    ),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Read current thread' }))
    await expect(await canvas.findByText('A new reply arrived')).toBeVisible()
    await expect(
      canvas.getByText(/previous decision belongs to an older thread version/),
    ).toBeVisible()
    await userEvent.click(canvas.getByLabelText('Follow up later'))
    await userEvent.click(canvas.getByRole('button', { name: 'Save local decision' }))
    await expect(versionSave).toHaveBeenCalled()
    await expect(versionSave.mock.lastCall?.[0].target.latestMessageId).toBe('message-2')
    await expect(versionSave.mock.lastCall?.[0].kind).toBe('follow_up_later')
  },
}
