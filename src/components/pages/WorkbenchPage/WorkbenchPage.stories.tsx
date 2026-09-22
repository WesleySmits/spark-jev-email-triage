import type { Meta, StoryObj } from '@storybook/react-vite'
import { useEffect, useState, type ComponentProps } from 'react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import QueueStories from '../../organisms/MessageQueue/MessageQueue.stories'
import ReaderStories from '../../organisms/MessageReader/MessageReader.stories'
import SidebarStories from '../../organisms/Sidebar/Sidebar.stories'
import TopBarStories from '../../organisms/TopBar/TopBar.stories'
import { fixtureBodyLoader, type BodyLoader, type InboxFixture } from '../../../app/inbox'
import type { WorkbenchMessage } from './workbench'
import { WorkbenchPage } from './WorkbenchPage'

type Props = ComponentProps<typeof WorkbenchPage>

// Sample data from the organisms' stories, plus a workflow and a body per
// message. The first message uses the reader story's letter. Bodies stay
// out of the rows: the page loads one when its message opens.
const details: Readonly<Record<string, Pick<InboxFixture, 'workflow' | 'body' | 'address'>>> = {
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

const messages: readonly WorkbenchMessage[] = QueueStories.args.messages.map((message) => {
  const { workflow, address } = details[message.id] ?? { workflow: 'review' }
  return { ...message, workflow, mailbox: message.account.marker, address }
})

const bodies = new Map(Object.entries(details).map(([id, { body }]) => [id, body]))

/** Loads the sample bodies, each after `delay` milliseconds or its own delay. */
const bodiesAfter = (delay: number, per: Readonly<Record<string, number>> = {}) =>
  fixtureBodyLoader(bodies, { delay: (id) => per[id] ?? delay })

/** Like `loader`, but ignores the page's abort, as a careless provider would. */
const ignoringAbort =
  (loader: BodyLoader): BodyLoader =>
  (id) =>
    loader(id, { signal: new AbortController().signal })

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

type Change = (update: (message: WorkbenchMessage) => WorkbenchMessage) => void

/**
 * The story's completion: read-only stays as it is. Otherwise the spies are
 * called, Complete moves the message to Done, at once or after
 * `completeAfter`, and Undo puts the sample message back.
 */
function sampleCompletion(
  { completion, messages }: Props,
  change: Change,
  { completeAfter, failComplete }: Timing,
): Props['completion'] {
  if (completion.mode === 'read-only') return completion
  const original = (id: string) => (message: WorkbenchMessage) =>
    message.id === id ? (messages.find((item) => item.id === id) ?? message) : message
  return {
    ...completion,
    onComplete: (id) => {
      void completion.onComplete(id)
      return later(
        () => {
          change(markDone(id))
        },
        completeAfter,
        failComplete,
      )
    },
    onUndoComplete: (id) => {
      completion.onUndoComplete?.(id)
      change(original(id))
    },
  }
}

// Stands in for the data owner. One page stays mounted while the data loads.
function WithData({ loadAfter, completeAfter, failComplete, ...args }: Props & Timing) {
  const [data, setData] = useState(args.messages)
  const loaded = useAfter(loadAfter)
  const change: Change = (update) => {
    setData((current) => current.map(update))
  }
  return (
    <WorkbenchPage
      {...args}
      messages={loaded ? data : []}
      workflows={loaded ? args.workflows : []}
      mailboxes={loaded ? args.mailboxes : []}
      completion={sampleCompletion(args, change, { completeAfter, failComplete })}
    />
  )
}

/** The spies behind Complete and Undo, for stories that may complete. */
function completionOf(args: Props) {
  if (args.completion.mode === 'read-only') throw new Error('This story is read-only')
  return args.completion
}

const meta = {
  title: 'Pages/Workbench',
  component: WorkbenchPage,
  args: {
    messages,
    loadBody: fn(bodiesAfter(0)),
    workflows: workflowGroup?.items ?? [],
    mailboxes: mailboxGroup?.items.filter((item) => item.account) ?? [],
    completion: {
      mode: 'enabled',
      onComplete: fn(),
      onUndoComplete: fn(),
      note: 'Sample data. No mail changed.',
    },
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
    loadBody: { control: false },
    completion: { control: 'object' },
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

// The line under the queue title that names the applied mailbox filter.
const queueContext = (root: HTMLElement) => root.querySelector('.queue-header__context')

// The reader's heading: the open subject, or its empty state's title.
const subject = (root: HTMLElement) =>
  within(within(root).getByRole('main')).getAllByRole('heading', { level: 2 }).at(-1)

// The reader's content region, where the body or its state shows.
const content = (root: HTMLElement) => within(root).getByRole('region', { name: 'Message content' })

/** Waits for the open body to show `text`. */
const bodyShows = (root: HTMLElement, text: string | RegExp) =>
  waitFor(() => expect(content(root)).toHaveTextContent(text), { timeout: 3000 })

/** At mobile width, opens the dinner message: its content takes focus. */
async function openDinnerOnMobile(root: HTMLElement) {
  await userEvent.click(within(root).getByRole('button', { name: /Move Friday dinner\?/ }))
  await expect(content(root)).toHaveFocus()
}

/** Back from the reader: focus returns to the dinner row. */
async function backToDinnerRow(root: HTMLElement) {
  await userEvent.click(within(root).getByRole('button', { name: 'Back to messages' }))
  await expect(within(root).getByRole('button', { name: /Move Friday dinner\?/ })).toHaveFocus()
}

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
  await userEvent.keyboard('j')
  await expect(canvas.getByRole('searchbox')).toHaveValue('j')
  await userEvent.clear(canvas.getByRole('searchbox'))
  await userEvent.click(canvas.getByRole('button', { name: /Move Friday dinner\?/ }))
  await userEvent.keyboard('j')
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
  // On a button / is left to it; from the page it jumps to the search.
  await userEvent.keyboard('/')
  await expect(canvas.getByRole('button', { name: 'Reset filters' })).toHaveFocus()
  blurFocus()
  await userEvent.keyboard('/')
  await expect(canvas.getByRole('searchbox')).toHaveFocus()
}

/** Moves focus off any control, back to the page itself. */
function blurFocus() {
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
}

const firstReview = /Can delivery move/
const lastReview = /Move Friday dinner\?/

/** Presses `keys` and checks the open message and the focused row stay put. */
async function keysChangeNothing(root: HTMLElement, keys: string, focused: HTMLElement) {
  const before = subject(root)?.textContent
  await userEvent.keyboard(keys)
  await expect(subject(root)).toHaveTextContent(before ?? '')
  await expect(focused).toHaveFocus()
}

/**
 * The workbench with sample data at 1280px. Pick a workflow or mailbox,
 * search, and open a message. Keys: K opens the next message and J the
 * previous one, E
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
 * K opens the next message and J the previous one, and they stop at either
 * end. Focus follows the open row. The keys do nothing on a rail filter,
 * with Ctrl, Alt or Cmd held, or when the filter shows no mail.
 */
export const KeyboardNavigation: Story = {
  globals: { viewport: { value: 'desktop', isRotated: false } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const row = (name: RegExp) => canvas.getByRole('button', { name })
    await userEvent.click(row(firstReview))
    // J on the first message and K on the last stay put.
    await keysChangeNothing(canvasElement, 'j', row(firstReview))
    await userEvent.keyboard('k')
    await expect(subject(canvasElement)).toHaveTextContent('Move Friday dinner?')
    await expect(row(lastReview)).toHaveFocus()
    await keysChangeNothing(canvasElement, 'K', row(lastReview))
    await userEvent.keyboard('J')
    await expect(subject(canvasElement)).toHaveTextContent('Can delivery move a week earlier?')
    await expect(row(firstReview)).toHaveFocus()

    // With Ctrl, Alt or Cmd the keys belong to the browser.
    for (const modifier of ['Control', 'Alt', 'Meta']) {
      await keysChangeNothing(
        canvasElement,
        `{${modifier}>}k{/${modifier}}{${modifier}>}j{/${modifier}}`,
        row(firstReview),
      )
    }

    // A mailbox filter keeps its focus and the open message stays.
    await rail(canvasElement, 'All accounts')
    const filter = canvas.getByRole('button', { name: /^All accounts/ })
    await keysChangeNothing(canvasElement, 'kj', filter)
    await rail(canvasElement, 'Needs review')
    await keysChangeNothing(
      canvasElement,
      'k',
      canvas.getByRole('button', { name: /^Needs review/ }),
    )

    // With no mail in the filter the keys do nothing.
    await rail(canvasElement, 'Personal')
    await rail(canvasElement, 'Done')
    blurFocus()
    await userEvent.keyboard('kj')
    await expect(subject(canvasElement)).toHaveTextContent('No message open')
    await expect(canvas.getByRole('heading', { name: 'No results in this filter' })).toBeVisible()
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
    await openDinnerOnMobile(canvasElement)
    await backToDinnerRow(canvasElement)
    // E does nothing while the queue hides the reader.
    await userEvent.keyboard('e')
    await expect(canvas.getByText('2 results')).toBeVisible()
    // Complete in the reader opens the next message and focuses its content.
    await userEvent.click(canvas.getByRole('button', { name: /Move Friday dinner\?/ }))
    await userEvent.click(canvas.getByRole('button', { name: 'Complete' }))
    await expect(subject(canvasElement)).toHaveTextContent('Can delivery move a week earlier?')
    await expect(content(canvasElement)).toHaveFocus()
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
    await expect(completionOf(args).onComplete).toHaveBeenCalledTimes(2)
    await expect(completionOf(args).onComplete).toHaveBeenNthCalledWith(1, 'm1')
    await expect(completionOf(args).onComplete).toHaveBeenNthCalledWith(2, 'm3')
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
    await expect(completionOf(args).onComplete).toHaveBeenLastCalledWith('m3')
    await userEvent.click(canvas.getByRole('button', { name: 'Undo' }))
    await expect(completionOf(args).onUndoComplete).toHaveBeenCalledWith('m3')
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
    await expect(completionOf(args).onComplete).toHaveBeenCalledTimes(1)
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

/** Nothing to show yet: every workflow is empty and the reader says so. K and J do nothing. */
export const NoMessages: Story = {
  args: { messages: [] },
  play: async ({ canvasElement }) => {
    await userEvent.keyboard('kjKJ')
    await expect(subject(canvasElement)).toHaveTextContent('No message open')
  },
}

/**
 * Bodies take half a second. Only the open message's body is asked for: the
 * reader says it is loading, then shows the text. Opening another message
 * asks for that one alone.
 */
export const BodyLoadsOnOpen: Story = {
  globals: { viewport: { value: 'desktop', isRotated: false } },
  args: { loadBody: fn(bodiesAfter(500)) },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(content(canvasElement)).toHaveTextContent('Loading message…')
    await bodyShows(canvasElement, 'Hi Wesley,')
    await expect(args.loadBody).toHaveBeenCalledTimes(1)
    await expect(args.loadBody).toHaveBeenLastCalledWith('m1', expect.anything())

    await userEvent.click(canvas.getByRole('button', { name: /Move Friday dinner\?/ }))
    await expect(content(canvasElement)).toHaveTextContent('Loading message…')
    await bodyShows(canvasElement, 'Would Saturday evening work')
    await expect(args.loadBody).toHaveBeenCalledTimes(2)
    await expect(args.loadBody).toHaveBeenLastCalledWith('m3', expect.anything())
  },
}

/**
 * The first body takes 1.5 seconds and its provider ignores the abort; the
 * user opens another message first. That message's body shows, and the late
 * response for the first one never replaces it.
 */
export const SlowBodyThenSwitch: Story = {
  globals: { viewport: { value: 'desktop', isRotated: false } },
  args: { loadBody: fn(ignoringAbort(bodiesAfter(100, { m1: 1500 }))) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(content(canvasElement)).toHaveTextContent('Loading message…')
    await userEvent.click(canvas.getByRole('button', { name: /Move Friday dinner\?/ }))
    await bodyShows(canvasElement, 'Would Saturday evening work')
    // Past the moment the first body arrives.
    await new Promise((resolve) => setTimeout(resolve, 1800))
    await expect(subject(canvasElement)).toHaveTextContent('Move Friday dinner?')
    await expect(content(canvasElement)).toHaveTextContent('Would Saturday evening work')
    await expect(content(canvasElement)).not.toHaveTextContent('Hi Wesley,')
  },
}

/** The first `times` requests for `id` fail; later ones work. */
function failingFirst(id: string, times: number, loader: BodyLoader): BodyLoader {
  let failures = 0
  return (requested, options) => {
    if (requested !== id || failures >= times) return loader(requested, options)
    failures += 1
    return Promise.reject(new Error('The mail provider is unavailable'))
  }
}

/**
 * The provider fails twice for the first body. The reader says so in place
 * and the list keeps working: another message loads. Opening the first
 * one again fails again; Try again then loads it without leaving it.
 */
export const BodyProviderError: Story = {
  globals: { viewport: { value: 'desktop', isRotated: false } },
  args: { loadBody: fn(failingFirst('m1', 2, bodiesAfter(100))) },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    await bodyShows(canvasElement, "This message didn't load")

    // The queue still works while the reader shows the failure.
    await userEvent.click(canvas.getByRole('button', { name: /Move Friday dinner\?/ }))
    await bodyShows(canvasElement, 'Would Saturday evening work')

    // Back to the first message: its second request fails too.
    await userEvent.click(canvas.getByRole('button', { name: /Can delivery move/ }))
    await bodyShows(canvasElement, "This message didn't load")
    await expect(args.loadBody).toHaveBeenCalledTimes(3)

    // Try again asks for the same open message once more, and it loads.
    await userEvent.click(within(content(canvasElement)).getByRole('button', { name: 'Try again' }))
    await expect(args.loadBody).toHaveBeenCalledTimes(4)
    await expect(args.loadBody).toHaveBeenLastCalledWith('m1', expect.anything())
    await bodyShows(canvasElement, 'Hi Wesley,')
    await expect(subject(canvasElement)).toHaveTextContent('Can delivery move a week earlier?')
    await expect(
      within(content(canvasElement)).queryByRole('button', { name: 'Try again' }),
    ).not.toBeInTheDocument()
  },
}

/** A message without a body says so instead of loading forever. */
export const MissingBody: Story = {
  globals: { viewport: { value: 'desktop', isRotated: false } },
  args: { loadBody: fn(fixtureBodyLoader(new Map([['m1', null]]))) },
  play: async ({ canvasElement }) => {
    await bodyShows(canvasElement, 'No text to show')
    await expect(
      within(content(canvasElement)).queryByRole('button', { name: 'Try again' }),
    ).not.toBeInTheDocument()
  },
}

const readOnly = { completion: { mode: 'read-only' } } satisfies Partial<Props>

/**
 * Read-only, as live mail will first be shown: no Complete button, no E in
 * the legend, E changes nothing and no Completed notice shows. The footer
 * says the view is read-only.
 */
export const ReadOnly: Story = {
  globals: { viewport: { value: 'desktop', isRotated: false } },
  args: readOnly,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await bodyShows(canvasElement, 'Hi Wesley,')
    await expect(canvas.queryByRole('button', { name: 'Complete' })).not.toBeInTheDocument()
    await expect(canvas.getByText('Read only')).toBeVisible()
    await expect(canvas.getByRole('complementary', { name: 'Filters' })).not.toHaveTextContent(
      'Complete',
    )
    await userEvent.click(canvas.getByRole('button', { name: /Can delivery move/ }))
    await userEvent.keyboard('e')
    await expect(canvas.getByText('2 results')).toBeVisible()
    await expect(subject(canvasElement)).toHaveTextContent('Can delivery move a week earlier?')
    await expect(canvas.getByRole('button', { name: /^Done/ })).toHaveTextContent('1')
    await expect(canvas.queryByText('Completed')).not.toBeInTheDocument()
    await expect(canvas.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument()
  },
}

/**
 * Read-only at 320px with slow bodies. Opening a message moves focus to its
 * content while the body loads, and it stays there when the body arrives.
 * Back returns focus to the row; another row loads its own body.
 */
export const ReadOnlyMobile: Story = {
  globals: { viewport: { value: 'mobile1', isRotated: false } },
  args: { ...readOnly, loadBody: fn(bodiesAfter(500)) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await openDinnerOnMobile(canvasElement)
    await expect(content(canvasElement)).toHaveTextContent('Loading message…')
    await bodyShows(canvasElement, 'Would Saturday evening work')
    await expect(content(canvasElement)).toHaveFocus()
    await expect(canvas.queryByRole('button', { name: 'Complete' })).not.toBeInTheDocument()
    await backToDinnerRow(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /Can delivery move/ }))
    await expect(content(canvasElement)).toHaveFocus()
    await bodyShows(canvasElement, 'Hi Wesley,')
  },
}

// Two mailboxes whose rows share one marker color, as live mail can.
const sharedMarker = messages.map((message, index) => {
  const mailbox = index % 2 === 0 ? 'first@mail.example' : 'second@mail.example'
  return {
    ...message,
    workflow: 'inbox',
    mailbox,
    account: { marker: 'studio', label: mailbox },
  } satisfies WorkbenchMessage
})

/**
 * Live-shaped and read-only: one workflow and two mailboxes with the same
 * marker color. A mailbox filter narrows by the mailbox itself, never by its
 * color, and the queue names it. Only the open message's body is asked for.
 */
export const SharedMarkerMailboxes: Story = {
  globals: { viewport: { value: 'desktop', isRotated: false } },
  args: {
    ...readOnly,
    messages: sharedMarker,
    loadBody: fn(bodiesAfter(0)),
    workflows: [{ id: 'inbox', icon: 'inbox', label: 'Recent mail' }],
    mailboxes: [
      { id: 'first@mail.example', account: 'studio', label: 'first@mail.example' },
      { id: 'second@mail.example', account: 'studio', label: 'second@mail.example' },
    ],
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('heading', { level: 1, name: 'Recent mail' })).toBeVisible()
    await expect(canvas.getByText('4 results')).toBeVisible()
    await expect(queueContext(canvasElement)).toHaveTextContent(/^All accounts$/)
    await bodyShows(canvasElement, 'Hi Wesley,')
    await rail(canvasElement, 'second@mail.example')
    await expect(canvas.getByText('2 results')).toBeVisible()
    await expect(queueContext(canvasElement)).toHaveTextContent(/^second@mail\.example$/)
    await expect(
      canvas.queryByRole('button', { name: /Can delivery move/ }),
    ).not.toBeInTheDocument()
    await expect(canvas.getByRole('button', { name: /Newsletter: work/ })).toBeVisible()
    await bodyShows(canvasElement, 'The company name on invoice AL-2048')
    await expect(args.loadBody).toHaveBeenCalledTimes(2)
    await expect(args.loadBody).toHaveBeenLastCalledWith('m2', expect.anything())
    await expect(canvas.queryByRole('button', { name: 'Complete' })).not.toBeInTheDocument()
  },
}
