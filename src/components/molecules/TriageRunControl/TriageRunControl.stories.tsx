import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'
import type { TriageRunSnapshot } from '../../../app/triage-run'
import { TriageRunControl } from './TriageRunControl'

const runId = '58c6210a-76d3-4ae2-8910-a36a87005794'

const classifiedItem = {
  mailbox: 'mailbox-studio',
  messageId: 'fictional-message-1',
  status: 'classified' as const,
  category: 'personal' as const,
  priority: 'high' as const,
  needsReview: true,
}

const running: TriageRunSnapshot = {
  runId,
  scope: { kind: 'worklist', label: 'Current worklist' },
  status: 'running',
  limits: { maxMessages: 12, maxJevCalls: 8 },
  counts: {
    selected: 12,
    processed: 5,
    classified: 4,
    alreadyCurrent: 1,
    providerFailures: 0,
    errors: 0,
    deferred: 0,
  },
  cost: { status: 'price_unavailable', jevCalls: 4, inputTokens: 1_240, outputTokens: 286 },
  shadowRunIds: [41],
  errorCodes: [],
  startedAt: '2026-09-24T09:42:00.000Z',
  items: [
    classifiedItem,
    { mailbox: 'mailbox-studio', messageId: 'fictional-message-2', status: 'queued' },
  ],
}

const completed: TriageRunSnapshot = {
  ...running,
  status: 'completed',
  counts: {
    ...running.counts,
    processed: 12,
    classified: 8,
    alreadyCurrent: 4,
  },
  cost: { status: 'price_unavailable', jevCalls: 8, inputTokens: 2_480, outputTokens: 572 },
  finishedAt: '2026-09-24T09:42:18.000Z',
  items: [
    classifiedItem,
    {
      mailbox: 'mailbox-studio',
      messageId: 'fictional-message-2',
      status: 'already_current',
      category: 'purchase',
      priority: 'normal',
    },
  ],
}

const meta = {
  title: 'Molecules/Jev run control',
  component: TriageRunControl,
  args: {
    worklistSize: 12,
    state: { phase: 'idle' },
    onStart: fn(),
    onResume: fn(),
    onRead: fn(),
    onStop: fn(),
    onRestart: fn(),
    onForget: fn(),
  },
  argTypes: {
    state: { control: 'object' },
    onStart: { control: false },
    onResume: { control: false },
    onRead: { control: false },
    onStop: { control: false },
    onRestart: { control: false },
    onForget: { control: false },
  },
  render: (args) => (
    <div style={{ width: 390, padding: 'var(--s4)', background: 'var(--paper)' }}>
      <TriageRunControl {...args} />
    </div>
  ),
} satisfies Meta<typeof TriageRunControl>

export default meta

type Story = StoryObj<typeof meta>

/** Nothing happens until the labelled Start button is pressed. */
export const ReadyToStart: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(args.onStart).not.toHaveBeenCalled()
    await userEvent.clear(canvas.getByRole('spinbutton', { name: 'Maximum messages' }))
    await userEvent.type(canvas.getByRole('spinbutton', { name: 'Maximum messages' }), '6')
    await userEvent.clear(canvas.getByRole('spinbutton', { name: 'Maximum Jev calls' }))
    await userEvent.type(canvas.getByRole('spinbutton', { name: 'Maximum Jev calls' }), '4')
    await userEvent.click(canvas.getByRole('button', { name: 'Start Jev triage' }))
    await expect(args.onStart).toHaveBeenCalledWith({ maxMessages: 6, maxJevCalls: 4 })
  },
}

export const RestoringReadback: Story = {
  args: { state: { phase: 'restoring' } },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText(/No Jev work is started/)).toBeVisible()
    await expect(args.onStart).not.toHaveBeenCalled()
    await expect(canvas.queryByRole('button', { name: 'Start Jev triage' })).not.toBeInTheDocument()
  },
}

export const Running: Story = {
  args: { state: { phase: 'run', run: running } },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('progressbar', { name: 'Jev triage progress' })).toHaveValue(5)
    await userEvent.click(canvas.getByRole('button', { name: 'Stop safely' }))
    await expect(args.onStop).toHaveBeenCalledOnce()
    await expect(canvas.queryByRole('button', { name: 'Start Jev triage' })).not.toBeInTheDocument()
  },
}

export const Stopping: Story = {
  args: { state: { phase: 'stopping', run: { ...running, status: 'stopping' } } },
}

export const CompletedWithReadback: Story = {
  args: { state: { phase: 'run', run: completed } },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Completed')).toBeVisible()
    await userEvent.click(canvas.getByText('Results by message'))
    await expect(canvas.getByText('fictional-message-1')).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'Read back' }))
    await expect(args.onRead).toHaveBeenCalledOnce()
  },
}

export const PartialProviderFailure: Story = {
  args: {
    state: {
      phase: 'run',
      run: {
        ...completed,
        status: 'partial',
        counts: { ...completed.counts, classified: 7, providerFailures: 1, errors: 1 },
        errorCodes: ['provider_timeout'],
        items: [
          classifiedItem,
          {
            mailbox: 'mailbox-studio',
            messageId: 'fictional-message-2',
            status: 'provider_failure',
            errorCode: 'provider_timeout',
          },
        ],
      },
    },
  },
}

export const UncertainStart: Story = {
  args: {
    state: {
      phase: 'uncertain',
      pending: {
        kind: 'start',
        request: {
          requestId: 'e0143c04-0cc5-4d73-9a38-54b89225a8d0',
          scope: { kind: 'worklist', reading: '96140040-fb6c-44b0-a671-2b02fc475f21' },
          limits: { maxMessages: 12, maxJevCalls: 8 },
        },
      },
    },
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('status')).toHaveTextContent(/same request/)
    await expect(canvas.queryByRole('button', { name: 'Start Jev triage' })).not.toBeInTheDocument()
    await userEvent.click(canvas.getByRole('button', { name: 'Resume same request' }))
    await expect(args.onResume).toHaveBeenCalledOnce()
  },
}

export const ReadbackUnavailable: Story = {
  args: { state: { phase: 'unavailable', run: running, runId } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('status')).toHaveTextContent(/saved run ID is kept/)
    await expect(canvas.getByRole('button', { name: 'Try readback' })).toBeVisible()
    await expect(canvas.queryByRole('button', { name: 'Stop safely' })).not.toBeInTheDocument()
    await expect(canvas.queryByRole('button', { name: 'Start Jev triage' })).not.toBeInTheDocument()
  },
}

export const DisabledByServer: Story = {
  args: { state: { phase: 'blocked', blockedReason: 'disabled' } },
}

export const Narrow: Story = {
  args: { state: { phase: 'run', run: completed } },
  render: (args) => (
    <div style={{ width: 280, padding: 'var(--s3)', background: 'var(--paper)' }}>
      <TriageRunControl {...args} />
    </div>
  ),
}
