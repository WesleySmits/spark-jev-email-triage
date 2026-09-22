import type { Meta, StoryObj } from '@storybook/react-vite'
import { useEffect, useState, type ComponentProps } from 'react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
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

type Timing = Readonly<{
  /** Milliseconds before the data arrives. Left out: there from the start. */
  loadAfter?: number | undefined
  /** Milliseconds before a completion shows in the data. Left out: at once. */
  completeAfter?: number | undefined
  /** Completions fail after `completeAfter`, as when Spark is unreachable. */
  failComplete?: boolean | undefined
}>

/** Whether `delay` has passed since mount; true at once without a delay. */
function useAfter(delay: number | undefined) {
  const [passed, setPassed] = useState(delay === undefined)
  useEffect(() => {
    if (delay === undefined) return
    const timer = setTimeout(() => {
      setPassed(true)
    }, delay)
    return () => {
      clearTimeout(timer)
    }
  }, [delay])
  return passed
}

const markDone = (id: string) => (message: WorkbenchMessage) =>
  message.id === id ? { ...message, workflow: 'done', status: completed } : message

/** Runs `apply` at once, or after `delay` as a promise that fails when `fail` is set. */
function later(apply: () => void, delay: number | undefined, fail: boolean | undefined) {
  if (delay === undefined) {
    apply()
    return undefined
  }
  return new Promise<void>((resolve, reject) => {
    setTimeout(() => {
      if (fail) {
        reject(new Error('Spark is unavailable'))
        return
      }
      apply()
      resolve()
    }, delay)
  })
}

// Stands in for the data owner. Complete moves the message to Done, at once
// or after `completeAfter`; Undo puts the sample message back. One page stays
// mounted while the data loads.
function WithData({ loadAfter, completeAfter, failComplete, ...args }: Props & Timing) {
  const [data, setData] = useState(args.messages)
  const loaded = useAfter(loadAfter)
  const original = (id: string) => (message: WorkbenchMessage) => ({
    ...(message.id === id ? (args.messages.find((item) => item.id === id) ?? message) : message),
  })
  return (
    <WorkbenchPage
      {...args}
      messages={loaded ? data : []}
      workflows={loaded ? args.workflows : []}
      mailboxes={loaded ? args.mailboxes : []}
      onComplete={(id) => {
        void args.onComplete(id)
        return later(
          () => {
            setData((current) => current.map(markDone(id)))
          },
          completeAfter,
          failComplete,
        )
      }}
      onUndoComplete={(id) => {
        args.onUndoComplete?.(id)
        setData((current) => current.map(original(id)))
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
    onUndoComplete: fn(),
    completedNote: 'Sample data. No mail changed.',
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

/** Opens the first review message and presses `keys`, e.g. 'e' to complete it. */
async function completeFirst(root: HTMLElement, keys: string) {
  await userEvent.click(within(root).getByRole('button', { name: /Can delivery move/ }))
  await userEvent.keyboard(keys)
}

/** Waits for a late completion to land in the data: Done counts `count`. */
const doneReaches = (root: HTMLElement, count: number) =>
  waitFor(
    () =>
      expect(within(root).getByRole('button', { name: /^Done/ })).toHaveTextContent(String(count)),
    { timeout: 3000 },
  )

/** A desktop story whose caller records each completion a second later. */
const recordedLater = {
  globals: { viewport: { value: 'desktop', isRotated: false } },
  render: (args) => <WithData {...args} completeAfter={1000} />,
} satisfies Story

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

/**
 * The messages and filters arrive after the page mounts, as from a request.
 * The page applies the first workflow and opens the first result then.
 */
export const DataArrivesLater: Story = {
  globals: { viewport: { value: 'desktop', isRotated: false } },
  render: (args) => <WithData {...args} loadAfter={300} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByText('2 results')).toBeVisible()
    await expect(canvas.getByRole('heading', { level: 1, name: 'Needs review' })).toBeVisible()
    await expect(subject(canvasElement)).toHaveTextContent('Can delivery move a week earlier?')
  },
}

/**
 * The caller takes a second to record each completion, as a request would.
 * A completed message leaves the list at once and can't be completed twice;
 * it shows under Done when the data catches up.
 */
export const SlowComplete: Story = {
  ...recordedLater,
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    await completeFirst(canvasElement, 'eee')
    await expect(canvas.getByText('0 results')).toBeVisible()
    await expect(args.onComplete).toHaveBeenCalledTimes(2)
    await expect(args.onComplete).toHaveBeenNthCalledWith(1, 'm1')
    await expect(args.onComplete).toHaveBeenNthCalledWith(2, 'm3')
    await doneReaches(canvasElement, 3)
    await expect(canvas.getByText('0 results')).toBeVisible()
  },
}

/**
 * After Complete the notice offers Undo until the user moves on. Undo puts
 * the message back, opens it again and returns focus to the page.
 */
export const UndoComplete: Story = {
  globals: { viewport: { value: 'desktop', isRotated: false } },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    await completeFirst(canvasElement, 'e')
    await expect(canvas.getByRole('status')).toHaveTextContent('Completed')
    await expect(canvas.getByText('1 result')).toBeVisible()
    // A filter that keeps the same message open still counts as moving on.
    await rail(canvasElement, 'Personal')
    await expect(subject(canvasElement)).toHaveTextContent('Move Friday dinner?')
    await expect(canvas.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument()
    // Moving on hides the notice for good, even when coming back.
    await rail(canvasElement, 'Done')
    await expect(canvas.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument()
    await rail(canvasElement, 'Needs review')
    await expect(canvas.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument()
    // Complete again, then undo from the notice.
    await userEvent.click(canvas.getByRole('button', { name: /Move Friday dinner\?/ }))
    await userEvent.keyboard('e')
    await expect(args.onComplete).toHaveBeenLastCalledWith('m3')
    await userEvent.click(canvas.getByRole('button', { name: 'Undo' }))
    await expect(args.onUndoComplete).toHaveBeenCalledWith('m3')
    await expect(canvas.getByText('1 result')).toBeVisible()
    await expect(subject(canvasElement)).toHaveTextContent('Move Friday dinner?')
    await expect(canvas.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument()
    // The list had emptied, so focus returns to the restored row.
    await expect(canvas.getByRole('button', { name: /Move Friday dinner\?/ })).toHaveFocus()
  },
}

/**
 * The caller records the completion after a second, but the user moves on
 * first: K, another workflow, then back to the same message. The late
 * result shows no notice, because it no longer belongs where the user is.
 */
export const LateCompleteAfterNavigation: Story = {
  ...recordedLater,
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    await completeFirst(canvasElement, 'e')
    await expect(subject(canvasElement)).toHaveTextContent('Move Friday dinner?')
    await userEvent.keyboard('k')
    await rail(canvasElement, 'Needs action')
    await expect(subject(canvasElement)).toHaveTextContent('Correction on invoice AL-2048')
    await rail(canvasElement, 'Needs review')
    // Back on the message the completion opened, before the result arrives.
    await expect(subject(canvasElement)).toHaveTextContent('Move Friday dinner?')
    await doneReaches(canvasElement, 2)
    await expect(args.onComplete).toHaveBeenCalledTimes(1)
    await expect(canvas.getByRole('status')).not.toHaveTextContent('Completed')
    await expect(canvas.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument()
  },
}

/**
 * The caller's completion fails after a second, as when Spark is
 * unreachable. The message leaves the list at once and comes back when the
 * failure arrives; no Completed notice shows.
 */
export const FailedComplete: Story = {
  globals: { viewport: { value: 'desktop', isRotated: false } },
  render: (args) => <WithData {...args} completeAfter={1000} failComplete />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await completeFirst(canvasElement, 'e')
    await expect(canvas.getByText('1 result')).toBeVisible()
    await waitFor(() => expect(canvas.getByText('2 results')).toBeVisible(), { timeout: 3000 })
    await expect(canvas.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument()
    await expect(canvas.getByRole('button', { name: /^Done/ })).toHaveTextContent('1')
  },
}

/**
 * Spark is unreachable: the top bar says so and when it last synced. The
 * page keeps working on the data it has.
 */
export const Disconnected: Story = {
  args: {
    topBar: {
      ...meta.args.topBar,
      syncStatus: 'disconnected',
      syncLabel: 'Disconnected · last sync 10:14',
    },
  },
}

/** Nothing to show yet: every workflow is empty and the reader says so. */
export const NoMessages: Story = {
  args: { messages: [] },
}
