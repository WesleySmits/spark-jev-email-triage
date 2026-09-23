import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ComponentProps, ReactNode } from 'react'
import { expect, within } from 'storybook/test'
import { ClassificationEvidence } from './ClassificationEvidence'

type Props = ComponentProps<typeof ClassificationEvidence>

// Fictional triage of one fictional message. Nothing here is read from a
// store or a classifier; the caller decides which state applies.
const judged = { label: 'Judged', text: '22 Sep, 09:15', dateTime: '2026-09-22T09:15:00.000Z' }

const labels: Props['facts'] = [
  { term: 'Category', value: 'Personal' },
  { term: 'Priority', value: 'High' },
  { term: 'Review', value: 'Accepted by the model', note: 'No person has reviewed this.' },
]

/** A reader-width column, like the strip's place under the reader header. */
function Frame({ children }: Readonly<{ children: ReactNode }>) {
  return <div style={{ maxWidth: 730, padding: 'var(--s4)' }}>{children}</div>
}

const meta = {
  title: 'Molecules/Classification evidence',
  component: ClassificationEvidence,
  args: {
    title: 'Jev triage',
    headingLevel: 3,
    state: { label: 'Triage current', tone: 'done' },
    detail: 'Checked against the thread that was read for this message.',
    facts: labels,
    judged,
  },
  argTypes: {
    title: { control: 'text' },
    headingLevel: { control: 'inline-radio', options: [2, 3, 4] },
    state: { control: 'object' },
    detail: { control: 'text' },
    facts: { control: 'object' },
    note: { control: 'text' },
    judged: { control: 'object' },
    className: { control: false },
  },
  render: (args) => (
    <Frame>
      <ClassificationEvidence {...args} />
    </Frame>
  ),
} satisfies Meta<typeof ClassificationEvidence>

export default meta

type Story = StoryObj<typeof meta>

/** A judgment a freshly read thread proved still describes this message. */
export const Current: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('heading', { level: 3, name: 'Jev triage' })).toBeVisible()
    await expect(canvas.getByText('Triage current')).toBeVisible()
    await expect(canvas.getByText('No person has reviewed this.')).toBeVisible()
  },
}

const fromEarlier = {
  state: { label: 'Triage from earlier', tone: 'neutral' },
  detail:
    'Stored by an earlier triage run. Nothing here read the thread, so it is not confirmed for the message as it stands now.',
} satisfies Partial<Props>

/**
 * What the store alone can say: a judgment from an earlier run that no read
 * has confirmed for the message as it stands now.
 */
export const FromEarlier: Story = { args: fromEarlier }

/** The thread moved on after it was judged. The old labels stay visible as such. */
export const Outdated: Story = {
  args: {
    state: { label: 'Triage outdated', tone: 'review' },
    detail:
      'A newer message arrived in this thread after it was judged. The labels below are the ones it was given then.',
  },
}

/** An uncertain priority and a review need, both shown and neither acted on. */
export const UncertainAndNeedsReview: Story = {
  args: {
    facts: [
      { term: 'Category', value: 'Purchase' },
      { term: 'Priority', value: 'Normal', note: 'The model was not sure of this priority.' },
      {
        term: 'Review',
        value: 'Needs a person',
        note: 'The model was unsure. Marked as more urgent to look at.',
      },
    ],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Needs a person')).toBeVisible()
    await expect(canvas.getByText(/not sure of this priority/)).toBeVisible()
  },
}

const failed = {
  state: { label: 'Triage failed', tone: 'danger' },
  detail: 'The classifier did not answer for this message, so nothing was judged.',
  note: 'Reported: timeout',
  facts: [],
} satisfies Partial<Props>

/** The classifier never answered, so nothing was judged and no labels show. */
export const Failed: Story = {
  args: failed,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Triage failed')).toBeVisible()
    await expect(canvas.queryByText('Category')).not.toBeInTheDocument()
  },
}

const notTriaged = {
  state: { label: 'Not triaged', tone: 'neutral' },
  detail: 'No triage run has stored anything for this message.',
  facts: [],
  judged: undefined,
} satisfies Partial<Props>

/** Nothing was stored for this message: unclassified, not failed. */
export const NotTriaged: Story = { args: notTriaged }

const unreadable = {
  state: { label: 'Triage unreadable', tone: 'neutral' },
  detail: 'What was stored could not be read. The mail itself is unaffected.',
  facts: [],
  judged: undefined,
} satisfies Partial<Props>

/** What was stored could not be read. Absence is not claimed, and mail is unaffected. */
export const Unreadable: Story = { args: unreadable }

const everyState: readonly Partial<Props>[] = [
  {},
  fromEarlier,
  {
    state: { label: 'Triage outdated', tone: 'review' },
    detail:
      'A newer message arrived in this thread after it was judged. The labels below are the ones it was given then.',
  },
  failed,
  notTriaged,
  unreadable,
]

/** Every state at once, to compare their words and tones. */
export const AllStates: Story = {
  argTypes: Object.fromEntries(
    Object.keys(meta.args).map((key) => [key, { table: { disable: true } }]),
  ),
  render: () => (
    <Frame>
      {everyState.map((state, index) => (
        <ClassificationEvidence key={index} {...meta.args} {...state} />
      ))}
    </Frame>
  ),
}

/** At 320px the facts stack under each other and nothing scrolls sideways. */
export const Mobile: Story = {
  args: fromEarlier,
  globals: { viewport: { value: 'mobile1', isRotated: false } },
}
