import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState, type ComponentProps } from 'react'
import { expect, fn, userEvent, within } from 'storybook/test'
import { HandlingPanel, type HandlingOptionView } from './HandlingPanel'

type Props = ComponentProps<typeof HandlingPanel>

// Fictional mail in a fictional mailbox. Nothing in these stories records a
// decision, proposes an action or reaches Spark.
const messageId = '11'

const handleNow: HandlingOptionView = {
  value: 'handle_now',
  label: 'Handle now',
  effect: `Proposes one guarded Spark Done for message ID ${messageId}. Approval, a fresh check and a readback still follow.`,
}

const outcomes: readonly HandlingOptionView[] = [
  handleNow,
  {
    value: 'reply_needed',
    label: 'Reply needed',
    effect: 'Keeps the work open here. The mail stays in your Inbox.',
  },
  {
    value: 'follow_up_later',
    label: 'Follow up later',
    effect: 'Keeps the work open here. Nothing is scheduled with Spark.',
  },
  {
    value: 'read_only',
    label: 'Read only',
    effect: 'No work owed. The mail stays where it is.',
  },
]

const note = `Reply needed, Follow up later and Read only record work in this app only: no Spark command is sent and the mail stays in your Inbox. Handle now proposes one guarded Spark Done for message ID ${messageId}; Spark acts on that ID, so another copy carrying it may change too. Nothing is stored here, so a decision is kept only while this message stays open.`

const base = {
  title: 'What happens next?',
  summary: 'Choose the work owed for this exact message version. Recording a choice moves no mail.',
  options: outcomes,
  chosen: null,
  onChoose: fn(),
  note,
  recordLabel: 'Record decision',
  onRecord: fn(),
  recordDisabled: true,
  tags: ['Decision', 'Local work status', 'Spark unchanged'],
  result: {
    title: 'Nothing recorded',
    detail:
      'Recording keeps a work status in this app. Only a separate guarded Done reaches Spark. Your mailbox is unchanged.',
  },
} satisfies Props

const meta = {
  title: 'Organisms/HandlingPanel',
  component: HandlingPanel,
  parameters: { layout: 'padded' },
  args: base,
} satisfies Meta<typeof HandlingPanel>

export default meta

type Story = StoryObj<typeof meta>

/** Nothing is chosen yet, so recording is refused and nothing is claimed. */
export const Undecided: Story = {}

/** Every outcome says what it changes before anyone commits to it. */
export const Chosen: Story = {
  render: function Interactive(args) {
    const [chosen, setChosen] = useState<string | null>(null)
    return (
      <HandlingPanel
        {...args}
        chosen={chosen}
        onChoose={setChosen}
        recordDisabled={chosen === null}
      />
    )
  },
  play: async ({ canvasElement }) => {
    const panel = within(canvasElement)
    await expect(panel.getByRole('button', { name: 'Record decision' })).toBeDisabled()
    await userEvent.click(panel.getByRole('radio', { name: 'Reply needed' }))
    await expect(panel.getByRole('radio', { name: 'Reply needed' })).toBeChecked()
    await expect(panel.getByRole('button', { name: 'Record decision' })).toBeEnabled()
    // One group: choosing another outcome unchooses the first.
    await userEvent.click(panel.getByRole('radio', { name: 'Handle now' }))
    await expect(panel.getByRole('radio', { name: 'Reply needed' })).not.toBeChecked()
  },
}

/** A recorded local outcome: work kept here, and the mail left where it is. */
export const RecordedLocally: Story = {
  args: {
    recorded: {
      title: 'Reply needed',
      detail:
        'Recorded in this app only. The mail stays in your Spark Inbox, and nothing was saved: this decision is kept while the message stays open. Your mailbox is unchanged.',
      state: { label: 'Local work status', tone: 'review' },
      changeLabel: 'Change decision',
      onChange: fn(),
    },
  },
}

/** Handle now, recorded: a proposal exists, and nothing has run. */
export const ProposedDone: Story = {
  args: {
    recorded: {
      title: 'Handle now',
      detail:
        'One guarded Spark Done is proposed below for the selected message ID. Approval and a confirmed readback both still have to happen. Your mailbox is unchanged.',
      state: { label: 'Proposed, not run', tone: 'review' },
      changeLabel: 'Change decision',
      onChange: fn(),
    },
  },
}

/**
 * An attempt that did not settle. The work stays open in words, and the
 * decision cannot be changed here because another automatic run is refused.
 */
export const UncertainAttempt: Story = {
  args: {
    recorded: {
      title: 'Handle now',
      detail:
        'Spark may have changed this message, and it may not. The work stays open until you check Spark yourself; no automatic retry is allowed. This attempt is locked, so the decision cannot be changed here.',
      state: { label: 'Still open, unresolved', tone: 'danger' },
      changeLabel: 'Change decision',
      onChange: fn(),
      changeDisabled: true,
    },
    tags: ['Decision', 'Spark may have changed', 'Work still open'],
  },
  play: async ({ canvasElement }) => {
    const panel = within(canvasElement)
    await expect(panel.getByRole('button', { name: 'Change decision' })).toBeDisabled()
    // The tags follow the attempt: nothing here may still say Spark is unchanged.
    await expect(panel.queryByText('Spark unchanged')).not.toBeInTheDocument()
  },
}

/** No Spark action path: Handle now is refused in words, not hidden. */
export const DoneNotConnected: Story = {
  args: {
    options: [
      {
        ...handleNow,
        effect: 'Not available here: no Spark action path is connected, so nothing is proposed.',
        disabled: true,
      },
      ...outcomes.slice(1),
    ],
  },
  play: async ({ canvasElement }) => {
    const panel = within(canvasElement)
    await expect(panel.getByRole('radio', { name: 'Handle now' })).toBeDisabled()
    await expect(panel.getByRole('radio', { name: 'Read only' })).toBeEnabled()
  },
}

/** At 320px the outcomes stack instead of squeezing their effect lines. */
export const Narrow: Story = {
  globals: { viewport: { value: 'mobile1', isRotated: false } },
  play: async ({ canvasElement }) => {
    await expect(canvasElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth)
  },
}

/**
 * What the local work record already holds for this message, read back above
 * the chooser, with the due-date field Follow up later offers. Deciding again
 * adds to what is kept; nothing here saves or reaches Spark.
 */
export const SavedReadbackWithDueDate: Story = {
  args: {
    ...base,
    chosen: 'follow_up_later',
    recordDisabled: false,
    workRecord: {
      saved: {
        heading: 'Saved in Open work',
        title: 'Follow up later',
        detail:
          'Saved by you on 26 Sep, 09:15, due Fri 2 Oct. It is about this exact mailbox copy and version, and stays open until you decide again.',
        state: { label: 'Open work', tone: 'review' },
      },
      field: (
        <p className="handling-panel__field">
          <label htmlFor="due-story">Due date (optional)</label>
          <input id="due-story" type="date" defaultValue="2026-10-02" />
        </p>
      ),
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Saved in Open work')).toBeVisible()
    await expect(canvas.getByText('Open work')).toBeVisible()
    const due = canvas.getByLabelText('Due date (optional)')
    await userEvent.click(due)
    await expect(due).toHaveFocus()
    // The chooser stays: deciding again is visibly adding to what is kept.
    await expect(canvas.getAllByRole('radio')).toHaveLength(4)
  },
}
