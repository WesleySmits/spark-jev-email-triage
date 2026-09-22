import type { Meta, StoryObj } from '@storybook/react-vite'
import { useEffect, useState, type ComponentProps } from 'react'
import { expect, fn, userEvent, within } from 'storybook/test'
import QueueStories from '../../organisms/MessageQueue/MessageQueue.stories'
import ReaderStories from '../../organisms/MessageReader/MessageReader.stories'
import SidebarStories from '../../organisms/Sidebar/Sidebar.stories'
import TopBarStories from '../../organisms/TopBar/TopBar.stories'
import type { WorkbenchMessage } from './workbench'
import { WorkbenchPage } from './WorkbenchPage'

type Props = ComponentProps<typeof WorkbenchPage>

// Sample data from the organisms' stories, plus a workflow and a body per
// message. The first message uses the reader story's letter.
const details: Readonly<Record<string, Pick<WorkbenchMessage, 'workflow' | 'body' | 'address'>>> = {
  m1: {
    workflow: 'review',
    body: ReaderStories.args.children,
    address: 'marit.vos@example.com',
  },
  m2: {
    workflow: 'action',
    body: 'Hi,\n\nThe company name on invoice AL-2048 is still missing the suffix Ltd. Could you send a corrected version?\n\nThanks,\nDaan',
    address: 'daan@atelierlinden.example',
  },
  m3: {
    workflow: 'review',
    body: 'Would Saturday evening work for you too? Then Koen can join after his match.\n\nMila',
  },
  m4: {
    workflow: 'done',
    body: 'This month we look at three compact workplaces and what they leave out.',
  },
}

const messages: readonly WorkbenchMessage[] = QueueStories.args.messages.map((message) => ({
  ...message,
  ...(details[message.id] ?? { workflow: 'review', body: message.snippet }),
}))

const [workflowGroup, mailboxGroup] = SidebarStories.args.groups

const completed = { label: 'Completed', tone: 'done' } as const

// Stands in for the data owner: Complete moves the message to Done.
function WithData(args: Props) {
  const [data, setData] = useState(args.messages)
  return (
    <WorkbenchPage
      {...args}
      messages={data}
      onComplete={(id) => {
        args.onComplete(id)
        setData(
          data.map((message) =>
            message.id === id ? { ...message, workflow: 'done', status: completed } : message,
          ),
        )
      }}
    />
  )
}

const meta = {
  title: 'Pages/Workbench',
  component: WorkbenchPage,
  args: {
    messages,
    workflows: workflowGroup?.items ?? [],
    mailboxes: mailboxGroup?.items.filter((item) => item.account) ?? [],
    onComplete: fn(),
    topBar: {
      syncStatus: TopBarStories.args.syncStatus,
      syncLabel: TopBarStories.args.syncLabel,
      onSyncClick: fn(),
      profileLabel: TopBarStories.args.profileLabel,
      profileInitials: TopBarStories.args.profileInitials,
    },
  },
  argTypes: {
    messages: { control: 'object' },
    workflows: { control: 'object' },
    mailboxes: { control: 'object' },
    topBar: { control: 'object' },
  },
  parameters: { layout: 'fullscreen' },
  render: (args) => <WithData {...args} />,
  // A bounded frame, like the app's 100dvh root, so the panes scroll.
  decorators: [
    (Story) => (
      <div style={{ height: '100dvh' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof WorkbenchPage>

export default meta

type Story = StoryObj<typeof meta>

const rail = (root: HTMLElement, name: string) =>
  userEvent.click(within(root).getByRole('button', { name: new RegExp(`^${name}`) }))

// The reader's heading: the open subject, or its empty state's title.
const subject = (root: HTMLElement) =>
  within(within(root).getByRole('main')).getAllByRole('heading', { level: 2 }).at(-1)

async function filtersAndSearch(root: HTMLElement) {
  const canvas = within(root)
  await expect(canvas.getByRole('heading', { level: 1, name: 'Needs review' })).toBeVisible()
  await expect(canvas.getByText('2 results')).toBeVisible()
  await expect(subject(root)).toHaveTextContent('Can delivery move a week earlier?')

  // A new filter opens its first result.
  await rail(root, 'Personal')
  await expect(canvas.getByText('1 result')).toBeVisible()
  await expect(subject(root)).toHaveTextContent('Move Friday dinner?')

  await rail(root, 'Done')
  await expect(canvas.getByRole('heading', { name: 'No results in this filter' })).toBeVisible()
  await expect(subject(root)).toHaveTextContent('No message open')
  await userEvent.click(canvas.getByRole('button', { name: 'Reset filters' }))
  await expect(canvas.getByText('2 results')).toBeVisible()
  await expect(canvas.getByRole('button', { name: /^Needs review/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(canvas.getByRole('button', { name: /^All accounts/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  )

  await userEvent.type(canvas.getByRole('searchbox'), 'saturday')
  await expect(canvas.getByText('1 result')).toBeVisible()
  await userEvent.click(canvas.getByRole('button', { name: /Move Friday dinner\?/ }))
  await expect(subject(root)).toHaveTextContent('Move Friday dinner?')
  await userEvent.clear(canvas.getByRole('searchbox'))
}

async function shortcuts(root: HTMLElement) {
  const canvas = within(root)
  // In the search field the keys type text; on a row they act.
  await userEvent.keyboard('k')
  await expect(canvas.getByRole('searchbox')).toHaveValue('k')
  await userEvent.clear(canvas.getByRole('searchbox'))
  await userEvent.click(canvas.getByRole('button', { name: /Move Friday dinner\?/ }))
  await userEvent.keyboard('k')
  await expect(subject(root)).toHaveTextContent('Can delivery move a week earlier?')
  await expect(canvas.getByRole('button', { name: /Can delivery move/ })).toHaveFocus()
  // E from a row: the next message opens and focus moves to its row.
  await userEvent.keyboard('E')
  await expect(subject(root)).toHaveTextContent('Move Friday dinner?')
  await expect(canvas.getByRole('button', { name: /Move Friday dinner\?/ })).toHaveFocus()
  await expect(canvas.getByRole('button', { name: /^Done/ })).toHaveTextContent('2')
  // The Complete button on the last message: focus lands on Reset filters.
  await userEvent.click(canvas.getByRole('button', { name: 'Complete' }))
  await expect(subject(root)).toHaveTextContent('No message open')
  await expect(canvas.getByRole('button', { name: 'Reset filters' })).toHaveFocus()
  await userEvent.keyboard('/')
  await expect(canvas.getByRole('searchbox')).toHaveFocus()
}

/**
 * The workbench with sample data at 1280px. Pick a workflow or mailbox,
 * search, and open a message. Keys: J and K move through the list, E
 * completes the open message (here it moves to Done), and / jumps to the
 * search. The play function checks filtering, search, opening, reset and the
 * keys.
 */
export const Desktop: Story = {
  globals: { viewport: { value: 'desktop', isRotated: false } },
  play: async ({ canvasElement }) => {
    await filtersAndSearch(canvasElement)
    await shortcuts(canvasElement)
  },
}

/**
 * At 320px the page starts on the queue. Opening a message shows the reader
 * and moves focus to its content; back returns to the queue with focus on
 * that row.
 */
export const Mobile: Story = {
  globals: { viewport: { value: 'mobile1', isRotated: false } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /Move Friday dinner\?/ }))
    await expect(canvas.getByRole('region', { name: 'Message content' })).toHaveFocus()
    await userEvent.click(canvas.getByRole('button', { name: 'Back to messages' }))
    await expect(canvas.getByRole('button', { name: /Move Friday dinner\?/ })).toHaveFocus()
    // E does nothing while the queue hides the reader.
    await userEvent.keyboard('e')
    await expect(canvas.getByText('2 results')).toBeVisible()
    // Complete in the reader opens the next message and focuses its content.
    await userEvent.click(canvas.getByRole('button', { name: /Move Friday dinner\?/ }))
    await userEvent.click(canvas.getByRole('button', { name: 'Complete' }))
    await expect(subject(canvasElement)).toHaveTextContent('Can delivery move a week earlier?')
    await expect(canvas.getByRole('region', { name: 'Message content' })).toHaveFocus()
  },
}

// Stands in for a caller that loads: empty props first, the data a moment later.
function LoadsLater(args: Props) {
  const [loaded, setLoaded] = useState(false)
  useEffect(() => {
    const timer = setTimeout(() => {
      setLoaded(true)
    }, 300)
    return () => {
      clearTimeout(timer)
    }
  }, [])
  return loaded ? (
    <WithData {...args} />
  ) : (
    <WorkbenchPage {...args} messages={[]} workflows={[]} mailboxes={[]} />
  )
}

/**
 * The messages and filters arrive after the page mounts, as from a request.
 * The page applies the first workflow and opens the first result then.
 */
export const DataArrivesLater: Story = {
  globals: { viewport: { value: 'desktop', isRotated: false } },
  render: (args) => <LoadsLater {...args} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByText('2 results')).toBeVisible()
    await expect(canvas.getByRole('heading', { level: 1, name: 'Needs review' })).toBeVisible()
    await expect(subject(canvasElement)).toHaveTextContent('Can delivery move a week earlier?')
  },
}

/** Nothing to show yet: every workflow is empty and the reader says so. */
export const NoMessages: Story = {
  args: { messages: [] },
}
