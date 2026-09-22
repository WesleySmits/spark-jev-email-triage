import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, fn, userEvent, within } from 'storybook/test'
import { ConnectionPanel } from './ConnectionPanel'

const steps = [
  'Open Spark on this Mac.',
  'Check that you are signed in.',
  "That's it. This list fills in on its own.",
]

const meta = {
  title: 'Molecules/Connection panel',
  component: ConnectionPanel,
  args: {
    tone: 'waiting',
    title: 'Waiting for Spark',
    steps,
    meta: 'Last checked 09:41:08 · Checks every 10 seconds',
    action: { label: 'Check now', onClick: fn() },
    note: 'Read only. This app never changes your mail.',
    headingLevel: 2,
  },
  argTypes: {
    tone: { control: 'inline-radio', options: ['waiting', 'checking', 'success', 'neutral'] },
    title: { control: 'text' },
    meta: { control: 'text' },
    hint: { control: 'text' },
    note: { control: 'text' },
    headingLevel: { control: 'inline-radio', options: [2, 3] },
  },
  decorators: [
    (Story) => (
      <div style={{ maxWidth: 400, border: '1px solid var(--line)' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ConnectionPanel>

export default meta

type Story = StoryObj<typeof meta>

/** Spark is closed or signed out. The page checks on its own; Check now skips ahead. */
export const Waiting: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const status = canvas.getByRole('status')
    await expect(status).toHaveTextContent('Waiting for Spark')
    await expect(status).not.toHaveTextContent('Last checked')
    await userEvent.click(canvas.getByRole('button', { name: 'Check now' }))
    await expect(args.action?.onClick).toHaveBeenCalledTimes(1)
  },
}

/** A check runs: the heading stays, so nothing new is announced; the action is busy. */
export const Checking: Story = {
  args: {
    tone: 'checking',
    meta: 'Checking now…',
    action: { label: 'Checking…', busy: true, onClick: fn() },
  },
  play: async ({ canvasElement, args }) => {
    const button = within(canvasElement).getByRole('button', { name: 'Checking…' })
    await expect(button).toHaveAttribute('aria-disabled', 'true')
    await expect(button).toBeEnabled()
    await userEvent.click(button)
    await expect(args.action?.onClick).not.toHaveBeenCalled()
  },
}

/** Spark answered; the inbox is being read. */
export const Answered: Story = {
  args: {
    tone: 'success',
    title: 'Spark answered',
    steps: undefined,
    description: ['Reading your recent mail. The list opens here in a moment.'],
    meta: undefined,
    action: { label: 'Reading mail…', busy: true, onClick: fn() },
  },
}

/** After about 5 minutes: same cadence, with a since-when and one piece of advice. */
export const StillWaiting: Story = {
  args: {
    meta: 'Still waiting. No answer since 09:36 · Checks every 10 seconds',
    hint: 'If Spark is open, quit it and open it again.',
  },
}

/** Spark answered in a shape that can't be read safely: checks only on request. */
export const Malformed: Story = {
  args: {
    tone: 'neutral',
    title: 'Spark sent something unexpected',
    steps: undefined,
    description: [
      'The mail list could not be read safely, so none is shown. Updating Spark may help.',
    ],
    meta: 'Last checked 09:41:08 · Checks only when you ask',
  },
}

/** Another computer: nothing to check, so no action. */
export const LocalOnly: Story = {
  args: {
    tone: 'neutral',
    title: 'Open this on the Mac that runs Spark',
    steps: undefined,
    description: [
      'Live mail is only read on the computer where Spark is signed in, so this browser gets none. Nothing is checked from here.',
      'On that Mac, open this app from localhost.',
    ],
    meta: undefined,
    action: undefined,
  },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).queryByRole('button')).toBeNull()
  },
}

// Flips between waiting and checking on click, like the page does, to show
// that the button and its focus stay put while it is busy.
function FocusStory(args: Parameters<typeof ConnectionPanel>[0]) {
  const [busy, setBusy] = useState(false)
  return (
    <ConnectionPanel
      {...args}
      tone={busy ? 'checking' : 'waiting'}
      meta={busy ? 'Checking now…' : args.meta}
      action={{
        label: busy ? 'Checking…' : 'Check now',
        busy,
        onClick: () => {
          setBusy(true)
        },
      }}
    />
  )
}

/** Check now keeps focus while busy, and the status region keeps its text. */
export const KeepsFocusWhileBusy: Story = {
  render: (args) => <FocusStory {...args} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const button = canvas.getByRole('button', { name: 'Check now' })
    button.focus()
    await userEvent.keyboard('{Enter}')
    await expect(canvas.getByRole('button', { name: 'Checking…' })).toBe(button)
    await expect(button).toHaveFocus()
    await expect(canvas.getByRole('status')).toHaveTextContent('Waiting for Spark')
  },
}

/** At 320px the action takes the full width with a 44px target, and nothing scrolls sideways. */
export const Narrow: Story = {
  globals: { viewport: { value: 'mobile1', isRotated: false } },
  play: async ({ canvasElement }) => {
    const button = within(canvasElement).getByRole('button', { name: 'Check now' })
    await expect(button.getBoundingClientRect().height).toBeGreaterThanOrEqual(44)
    const root = canvasElement.ownerDocument.documentElement
    await expect(root.scrollWidth).toBeLessThanOrEqual(root.clientWidth)
  },
}
