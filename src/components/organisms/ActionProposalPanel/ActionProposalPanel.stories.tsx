import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState, type ComponentProps } from 'react'
import { expect, fn, userEvent, within } from 'storybook/test'
import {
  ActionProposalPanel,
  type ActionStage,
  type ActionTargetView,
  type PreconditionView,
} from './ActionProposalPanel'

type Props = ComponentProps<typeof ActionProposalPanel>

// Fictional mail in a fictional mailbox: the same sample copies the rest of
// the workbench stories use. Nothing here reaches a mailbox.
const studioCopy: ActionTargetView = {
  id: 'studio:11',
  label: 'Studio Noord',
  identity: 'studio@mail.example · message 11',
  detail:
    'Proposed against thread t-11, latest message 11. A thread read for this copy still ends there.',
}

const aliasCopy: ActionTargetView = {
  id: 'atelier:11',
  label: 'Atelier Linden',
  identity: 'atelier@mail.example · message 11',
  detail:
    'Proposed against thread t-11, latest message 11. Nothing read says where this copy stands now.',
}

const execution: ActionStage = {
  id: 'execution',
  name: 'Execution',
  state: { label: 'Blocked', tone: 'neutral' },
  detail:
    'This app has no way to write to a mailbox, so no proposal can be carried out. Your mailbox is unchanged.',
}

const stages = (proposal: ActionStage, approval: ActionStage): readonly ActionStage[] => [
  proposal,
  approval,
  execution,
]

const proposed: ActionStage = {
  id: 'proposal',
  name: 'Proposal',
  state: { label: 'Proposed', tone: 'review' },
  detail: 'Archive, against the 1 mailbox copy named below.',
}

const waiting: ActionStage = {
  id: 'approval',
  name: 'Approval',
  state: { label: 'Waiting for you', tone: 'review' },
  detail: 'Approving records your decision here. No mail provider is asked for anything.',
}

const approved: ActionStage = {
  id: 'approval',
  name: 'Approval',
  state: { label: 'Approved', tone: 'done' },
  detail: 'Approved by you, at this computer. That decision is recorded here and nowhere else.',
}

const effectOf = (copies: string, note = 'Archive') =>
  ({
    title: 'What it would change',
    statement: `If this were ever carried out, it would ask a mail provider to archive the ${copies} named above, and nothing else.`,
    note: `What a provider does when asked that is not verified here — including whether it would touch anything else in the thread, and what ${note.toLowerCase()} means to it. Nothing has been asked, nothing can be, and your mailbox is unchanged.`,
  }) satisfies Props['effect']

const adapter: PreconditionView = {
  id: 'write_adapter_connected',
  label: 'Something could carry the action out',
  state: { label: 'Not connected', tone: 'neutral' },
}

const approval = (label: string): PreconditionView => ({
  id: 'human_approval',
  label: 'A person approved this exact proposal',
  state: { label, tone: label === 'Met' ? 'done' : 'neutral' },
})

const thread = (copy: string, label: string): PreconditionView => ({
  id: `thread_unchanged:${copy}`,
  label: `The thread of ${copy} still ends at message 11`,
  state: { label, tone: label === 'Met' ? 'done' : 'neutral' },
})

const meta = {
  title: 'Organisms/Action proposal panel',
  component: ActionProposalPanel,
  args: {
    headingLevel: 2,
    title: 'Mailbox action',
    summary: 'Proposed here, approved by you, and never carried out.',
    stages: stages(proposed, waiting),
    targetsTitle: 'Mailbox copies named',
    targets: [studioCopy],
    targetsNote:
      'Only the copies named here would be acted on, by the mailbox and message ids shown. The same message in another mailbox is a separate copy, and nothing adds it for you.',
    targetsEmpty: 'Nothing is proposed, so no mailbox copy is named.',
    effect: effectOf('copy'),
    preconditionsTitle: 'Before anything could run',
    preconditions: [thread('Studio Noord', 'Met'), approval('Not met'), adapter],
    actions: [
      { id: 'approve', label: 'Approve', variant: 'secondary', onClick: fn() },
      { id: 'withdraw', label: 'Withdraw', variant: 'quiet', onClick: fn() },
    ],
    result: {
      title: 'Not approved',
      detail: 'Approving records your decision here. Your mailbox is unchanged.',
    },
  },
  argTypes: {
    headingLevel: { control: 'inline-radio', options: [2, 3, 4] },
    stages: { control: 'object' },
    targets: { control: 'object' },
    preconditions: { control: 'object' },
    actions: { control: false },
    result: { control: 'object' },
  },
  // The reader gives the panel at most 820px.
  decorators: [
    (Story) => (
      <div style={{ maxWidth: 820 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ActionProposalPanel>

export default meta

type Story = StoryObj<typeof meta>

/**
 * One archive proposed against one named mailbox copy, waiting for a person.
 * The three stages read apart: something is proposed, nobody has approved it,
 * and execution is blocked whatever happens above it.
 */
export const Proposed: Story = {}

/** Before anything is proposed: the stages still say where this can go. */
export const NothingProposed: Story = {
  args: {
    stages: stages(
      {
        id: 'proposal',
        name: 'Proposal',
        state: { label: 'Nothing proposed', tone: 'neutral' },
        detail: 'Nothing is proposed for this message.',
      },
      {
        id: 'approval',
        name: 'Approval',
        state: { label: 'Not approved', tone: 'neutral' },
        detail: 'A person approves a proposal as its own step. Nothing approves itself here.',
      },
    ),
    targets: [],
    effect: {
      title: 'What it would change',
      statement: 'Nothing is proposed, so nothing would change.',
      note: 'Your mailbox is unchanged.',
    },
    preconditions: [approval('Not met'), adapter],
    actions: [{ id: 'propose', label: 'Propose archive', variant: 'secondary', onClick: fn() }],
    result: {
      title: 'Nothing proposed',
      detail: 'Proposing names this one mailbox copy and no other. Your mailbox is unchanged.',
    },
  },
}

/**
 * Approved by a person, and still not carried out. The approval stage says
 * who decided; execution stays blocked, and the result never says a message
 * was archived.
 */
export const Approved: Story = {
  args: {
    stages: stages(proposed, approved),
    preconditions: [thread('Studio Noord', 'Met'), approval('Met'), adapter],
    actions: [{ id: 'withdraw', label: 'Withdraw', variant: 'quiet', onClick: fn() }],
    result: {
      title: 'Approved, not carried out',
      detail:
        'Nothing was sent to your mail provider, and nothing can be. Your mailbox is unchanged.',
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)

    await expect(canvas.getByText('Blocked')).toBeVisible()
    await expect(canvas.getByText('Not connected')).toBeVisible()
    await expect(canvasElement).not.toHaveTextContent(/archived|completed/i)
  },
}

/**
 * A later message reached the thread, so the proposal and the approval that
 * was given both lapse. Approving is offered but refused, and the copy says
 * what to do instead.
 */
export const OutOfDate: Story = {
  args: {
    stages: stages(
      {
        id: 'proposal',
        name: 'Proposal',
        state: { label: 'Out of date', tone: 'danger' },
        detail: 'A later message has reached this thread since.',
      },
      {
        id: 'approval',
        name: 'Approval',
        state: { label: 'No longer holds', tone: 'danger' },
        detail: 'You approved the version this message has moved past, so that approval lapsed.',
      },
    ),
    targets: [
      {
        ...studioCopy,
        detail:
          'Proposed against thread t-11, latest message 11. A later message has reached this thread since.',
      },
    ],
    preconditions: [thread('Studio Noord', 'Not met'), approval('Not met'), adapter],
    actions: [
      { id: 'approve', label: 'Approve', variant: 'secondary', disabled: true, onClick: fn() },
      { id: 'withdraw', label: 'Withdraw', variant: 'quiet', onClick: fn() },
    ],
    result: {
      title: 'Out of date',
      detail: 'A later message has reached this thread since. Your mailbox is unchanged.',
    },
  },
}

/**
 * Two alias copies of one delivery, both named because both were chosen.
 * Each carries its own version and its own standing: reading one thread says
 * nothing about the other, and neither copy was added for the person.
 */
export const TwoAliasCopies: Story = {
  args: {
    stages: stages(
      { ...proposed, detail: 'Archive, against the 2 mailbox copies named below.' },
      waiting,
    ),
    targets: [studioCopy, aliasCopy],
    effect: effectOf('copies'),
    preconditions: [
      thread('Studio Noord', 'Met'),
      thread('Atelier Linden', 'Not met'),
      approval('Not met'),
      adapter,
    ],
  },
}

/** The whole panel in a narrow reader column, where the stages stack. */
export const Narrow: Story = {
  decorators: [
    (Story) => (
      <div style={{ maxWidth: 420 }}>
        <Story />
      </div>
    ),
  ],
}

/** The approved panel: the stages, preconditions and result it then shows. */
const approvedArgs = {
  stages: stages(proposed, approved),
  preconditions: [thread('Studio Noord', 'Met'), approval('Met'), adapter],
  result: {
    title: 'Approved, not carried out',
    detail:
      'Nothing was sent to your mail provider, and nothing can be. Your mailbox is unchanged.',
  },
} satisfies Partial<Props>

/**
 * Stands in for the caller: it keeps what a person approved and announces it
 * through its own polite live region. The panel announces nothing itself.
 */
function ApprovingFixture(args: Props) {
  const [done, setDone] = useState(false)
  const [announcement, setAnnouncement] = useState('')
  return (
    <div style={{ display: 'grid', gap: 'var(--s3)' }}>
      <ActionProposalPanel
        {...args}
        {...(done ? approvedArgs : {})}
        actions={
          done
            ? [{ id: 'withdraw', label: 'Withdraw', variant: 'quiet', onClick: fn() }]
            : [
                {
                  id: 'approve',
                  label: 'Approve',
                  variant: 'secondary',
                  onClick: () => {
                    setDone(true)
                    setAnnouncement(`${approvedArgs.result.title}. ${approvedArgs.result.detail}`)
                  },
                },
              ]
        }
      />
      <p role="status" aria-live="polite" style={{ margin: 0, font: 'var(--text-meta)' }}>
        {announcement}
      </p>
    </div>
  )
}

/**
 * Approving, as its own step. Pressing Approve moves only the approval
 * stage; execution stays blocked, and the caller announces what happened.
 */
export const Approving: Story = {
  render: (args) => <ApprovingFixture {...args} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)

    await expect(canvas.getByText('Waiting for you')).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'Approve' }))
    await expect(canvas.getByText('Approved')).toBeVisible()
    await expect(canvas.getByText('Blocked')).toBeVisible()
    await expect(canvas.getByRole('status')).toHaveTextContent('not carried out')
  },
}
