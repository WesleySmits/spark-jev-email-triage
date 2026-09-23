import type { Meta, StoryObj } from '@storybook/react-vite'
import { useEffect, useState, type ComponentProps } from 'react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import QueueStories from '../../organisms/MessageQueue/MessageQueue.stories'
import ReaderStories from '../../organisms/MessageReader/MessageReader.stories'
import SidebarStories from '../../organisms/Sidebar/Sidebar.stories'
import TopBarStories from '../../organisms/TopBar/TopBar.stories'
import { fixtureBodyLoader, type BodyLoader, type InboxFixture } from '../../../app/inbox'
import type { DeskReviewOutcome, DeskReviewRequest, RowReview } from '../../../app/desk-review'
import type { StoredClassification } from '../../../domain/stored-classification'
import type { ListedEvidence } from './classification'
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

/** The spy behind one review, for stories that may review. */
function reviewOf(args: Props) {
  if (args.review?.mode !== 'enabled') throw new Error('This story offers no review')
  return args.review
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

// Fictional stored triage of the fictional mail above. Nothing is read from
// a store here: the story passes what a reading would have carried.
const judgedAt = '2026-09-22T09:15:00.000Z'

/** The mailbox a sample row was listed in, as its own summary names it. */
const mailboxOf = (id: string) => messages.find((message) => message.id === id)?.mailbox ?? 'studio'

const subjectOf = (id: string) => ({
  copy: { mailboxId: mailboxOf(id), messageId: id },
  threadId: `t-${id}`,
  latestMessageId: id,
  rubric: 'email-triage.v2',
  classifierVersion: 'jev-1.13.0',
})

const judgedLabels = {
  category: 'personal',
  priority: 'high',
  confidence: 0.93,
  priorityUncertain: false,
  review: 'auto_accepted',
  reviewPriority: 'normal',
} as const

/** What the store alone can say about m1: judged, and nothing contradicts it. */
const m1Unverified: StoredClassification = {
  state: 'unverified',
  subject: subjectOf('m1'),
  judgedAt,
  labels: judgedLabels,
}

/** The same judgment, once the thread read for m1 proved it names this version. */
const m1Current: StoredClassification = { ...m1Unverified, state: 'current' }

/** The same judgment, once that read found the thread had moved on. */
const m1Stale: StoredClassification = { ...m1Unverified, state: 'stale', reason: 'newer_message' }

const storedStates: Readonly<Record<string, StoredClassification>> = {
  m1: m1Unverified,
  m2: {
    state: 'stale',
    reason: 'newer_message',
    subject: subjectOf('m2'),
    judgedAt,
    labels: {
      ...judgedLabels,
      category: 'purchase',
      priority: 'normal',
      confidence: 0.61,
      priorityUncertain: true,
      review: 'needs_review',
      reviewPriority: 'elevated',
    },
  },
  m3: { state: 'provider_failure', subject: subjectOf('m3'), judgedAt, errorCode: 'timeout' },
  m4: { state: 'none' },
}

/** Sample bodies that carry what the thread each read returned proved about its row. */
const provingBodies = (proofs: Readonly<Record<string, StoredClassification>>): BodyLoader => {
  const load = bodiesAfter(0)
  return async (id, options) => {
    const body = await load(id, options)
    const proof = proofs[id]
    return body === null || proof === undefined ? body : { ...body, classification: proof }
  }
}

const oneWorkflow: Props['workflows'] = [{ id: 'inbox', icon: 'inbox', label: 'Recent mail' }]

/** Every sample message in the one workflow live mail has. */
const listedRows = messages.map((message) => ({ ...message, workflow: 'inbox' }))

/** One reading of the desk, as the route hands one over: its id and its rows. */
const reading = (id: string, states = storedStates) => ({ reading: id, states }) as const

const classified = {
  ...readOnly,
  messages: listedRows,
  workflows: oneWorkflow,
  classifications: reading('reading-1'),
} satisfies Partial<Props>

/** The evidence strip under the reader header, whatever it says. */
function evidence(root: HTMLElement) {
  const strip = root.querySelector('.workbench__reader .classification-evidence')
  if (!strip) throw new Error('No classification evidence in the reader')
  return strip
}

/**
 * Live-shaped and read-only: every row says what triage stored about it, and
 * the open row also says what the thread its body read returned proved. Only
 * that read can say a judgment is current; the rows the reader never opened
 * stay at what the store alone can say. Nothing here classifies, and no row
 * offers a way to change mail.
 */
export const StoredClassifications: Story = {
  globals: { viewport: { value: 'desktop', isRotated: false } },
  args: { ...classified, loadBody: fn(provingBodies({ m1: m1Current })) },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const row = (name: RegExp) => canvas.getByRole('button', { name })

    // The open row's body proved its judgment; the others stay unproven.
    await waitFor(() => expect(evidence(canvasElement)).toHaveTextContent('Triage current'))
    await expect(evidence(canvasElement)).toHaveTextContent('Accepted by the model')
    await expect(evidence(canvasElement)).toHaveTextContent('No person has reviewed this.')
    await expect(row(/Can delivery move/)).toHaveTextContent('Triage current')
    await expect(row(/Correction on invoice/)).toHaveTextContent('Triage outdated')
    await expect(row(/Move Friday dinner\?/)).toHaveTextContent('Triage failed')
    await expect(row(/Newsletter: work/)).toHaveTextContent('Not triaged')

    // An outdated judgment keeps its labels, its uncertainty and its review need.
    await userEvent.click(row(/Correction on invoice/))
    await expect(evidence(canvasElement)).toHaveTextContent('Triage outdated')
    await expect(evidence(canvasElement)).toHaveTextContent('Purchase')
    await expect(evidence(canvasElement)).toHaveTextContent('not sure of this priority')
    await expect(evidence(canvasElement)).toHaveTextContent('Needs a person')

    // A failed attempt is never a classification, and absence is not failure.
    await userEvent.click(row(/Move Friday dinner\?/))
    await expect(evidence(canvasElement)).toHaveTextContent('Reported: timeout')
    await expect(evidence(canvasElement)).not.toHaveTextContent('Category')
    await userEvent.click(row(/Newsletter: work/))
    await expect(evidence(canvasElement)).toHaveTextContent('No triage run has stored anything')

    // Only the open message's body was ever asked for, one at a time.
    await expect(args.loadBody).toHaveBeenCalledTimes(4)
    await expect(canvas.queryByRole('button', { name: 'Complete' })).not.toBeInTheDocument()
    await expect(canvas.queryByRole('button', { name: /Save/ })).not.toBeInTheDocument()
  },
}

/**
 * Opening a row is also how a judgment can turn out to be outdated: the
 * thread its body read had moved on since the run. The row and the reader
 * both say so, and the labels stay visible as the ones it was given then.
 */
export const ClassificationOutdatedOnOpen: Story = {
  globals: { viewport: { value: 'desktop', isRotated: false } },
  args: { ...classified, loadBody: fn(provingBodies({ m1: m1Stale })) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await waitFor(() => expect(evidence(canvasElement)).toHaveTextContent('Triage outdated'))
    await expect(evidence(canvasElement)).toHaveTextContent('A newer message arrived')
    await expect(evidence(canvasElement)).toHaveTextContent('Personal')
    await expect(canvas.getByRole('button', { name: /Can delivery move/ })).toHaveTextContent(
      'Triage outdated',
    )
  },
}

/**
 * A body read that proves nothing about the open row leaves the reading's own
 * evidence in place: a judgment from an earlier run stays exactly that, and
 * is never shown as current.
 */
export const UnprovenStaysUnproven: Story = {
  globals: { viewport: { value: 'desktop', isRotated: false } },
  args: { ...classified, loadBody: fn(bodiesAfter(0)) },
  play: async ({ canvasElement }) => {
    await bodyShows(canvasElement, 'Hi Wesley,')
    await expect(evidence(canvasElement)).toHaveTextContent('Triage from earlier')
    await expect(evidence(canvasElement)).toHaveTextContent('not confirmed')
    await expect(evidence(canvasElement)).not.toHaveTextContent('Triage current')
  },
}

/**
 * The stored judgments could not be read at all. Every row says so, none of
 * them claims to be untriaged, and all the mail still shows and reads.
 */
export const ClassificationsUnreadable: Story = {
  globals: { viewport: { value: 'desktop', isRotated: false } },
  args: {
    ...classified,
    classifications: reading(
      'reading-1',
      Object.fromEntries(
        listedRows.map((message) => [
          message.id,
          { state: 'unavailable', reason: 'unsupported_schema' } as const,
        ]),
      ),
    ),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('4 results')).toBeVisible()
    await expect(canvas.getAllByText('Triage unreadable')).toHaveLength(5)
    await bodyShows(canvasElement, 'Hi Wesley,')
    await expect(evidence(canvasElement)).toHaveTextContent(
      'written by a version of this app that this one cannot read',
    )
  },
}

/**
 * The mobile reader at 320px: the evidence sits above the message it
 * describes, so it is the first thing the content region announces.
 */
export const StoredClassificationsMobile: Story = {
  globals: { viewport: { value: 'mobile1', isRotated: false } },
  args: { ...classified, loadBody: fn(provingBodies({ m1: m1Current })) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /Can delivery move/ }))
    await expect(content(canvasElement)).toHaveFocus()
    await waitFor(() => expect(evidence(canvasElement)).toHaveTextContent('Triage current'))
    await expect(content(canvasElement).firstElementChild).toHaveClass('message-reader__evidence')
  },
}

/**
 * Stands in for the route's loader: each Refresh reads the desk again, so
 * the page gets a new reading of the same rows. The store has not changed,
 * so every judgment is listed exactly as before. Nothing re-reads a body.
 */
function WithReadings(args: Props) {
  const [count, setCount] = useState(1)
  return (
    <WorkbenchPage
      {...args}
      classifications={reading(`reading-${String(count)}`)}
      topBar={{
        ...args.topBar,
        syncActionLabel: 'Refresh mail',
        onSyncClick: () => {
          setCount((current) => current + 1)
        },
      }}
    />
  )
}

/**
 * Refresh lists the mailbox again, and the provider may have moved on since
 * the open row's thread was read. Nothing re-reads that thread, so what the
 * earlier read proved stops counting: the row and the reader fall back to
 * what the store alone says, without a single extra request. Opening the
 * thread anew proves it again under the reading that is current then.
 */
export const RefreshOutlivesProof: Story = {
  globals: { viewport: { value: 'desktop', isRotated: false } },
  args: { ...classified, loadBody: fn(provingBodies({ m1: m1Current })) },
  render: (args) => <WithReadings {...args} />,
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const open = () => canvas.getByRole('button', { name: /Can delivery move/ })
    await waitFor(() => expect(evidence(canvasElement)).toHaveTextContent('Triage current'))
    await expect(open()).toHaveTextContent('Triage current')
    await expect(args.loadBody).toHaveBeenCalledTimes(1)

    // Refresh: the same row stays open and the same judgment is listed, but
    // the proof belonged to the reading before it.
    await userEvent.click(canvas.getByRole('button', { name: 'Refresh mail' }))
    await expect(evidence(canvasElement)).toHaveTextContent('Triage from earlier')
    await expect(evidence(canvasElement)).toHaveTextContent('not confirmed')
    await expect(open()).toHaveTextContent('Triage from earlier')
    // No thread was read to find that out, and the body that was read stays.
    await expect(args.loadBody).toHaveBeenCalledTimes(1)
    await expect(content(canvasElement)).toHaveTextContent('Hi Wesley,')

    // Reading the thread anew proves it under the reading that is current now.
    await userEvent.click(canvas.getByRole('button', { name: /Move Friday dinner\?/ }))
    await userEvent.click(open())
    await waitFor(() => expect(evidence(canvasElement)).toHaveTextContent('Triage current'))
    await expect(args.loadBody).toHaveBeenCalledTimes(3)

    // Rendering the same reading again keeps what it proved.
    await userEvent.click(canvas.getByRole('searchbox'))
    await userEvent.keyboard('delivery')
    await expect(canvas.getByText('1 result')).toBeVisible()
    await expect(evidence(canvasElement)).toHaveTextContent('Triage current')
    await expect(args.loadBody).toHaveBeenCalledTimes(3)
  },
}

// Stands in for the desk's review seam. It records nothing anywhere: a story
// only says what the store would have answered, after `delay` milliseconds.
type ReviewAnswer = Readonly<{
  /** The store's answer, or how it answers the request it was given. */
  outcome: DeskReviewOutcome | ((request: DeskReviewRequest) => DeskReviewOutcome)
  delay?: number | undefined
}>

const answering =
  ({ outcome, delay = 0 }: ReviewAnswer) =>
  (request: DeskReviewRequest): Promise<DeskReviewOutcome> =>
    new Promise((resolve) =>
      setTimeout(() => {
        resolve(typeof outcome === 'function' ? outcome(request) : outcome)
      }, delay),
    )

const recorded: DeskReviewOutcome = { status: 'recorded' }

const suspicious = { category: 'suspicious', priority: 'urgent' } as const

// The same judgment of m1, but one the model was unsure of, so its panel
// opens itself. `m1Unverified` keeps the auto-accepted labels, for the story
// that shows what a row the model accepted offers instead.
const unsureLabels = { ...judgedLabels, confidence: 0.58, review: 'needs_review' } as const
const m1Unsure: StoredClassification = { ...m1Unverified, labels: unsureLabels }
const m1UnsureCurrent: StoredClassification = { ...m1Unsure, state: 'current' }

const unsureStates: Readonly<Record<string, StoredClassification>> = {
  ...storedStates,
  m1: m1Unsure,
}

/** A story whose open row may be reviewed, answering as `answer` says. */
const reviewing = (
  answer: ReviewAnswer,
  states: Readonly<Record<string, StoredClassification>> = unsureStates,
) =>
  ({
    ...classified,
    classifications: reading('reading-1', states),
    loadBody: fn(
      provingBodies(states === unsureStates ? { m1: m1UnsureCurrent } : { m1: m1Current }),
    ),
    review: { mode: 'enabled', onSaveReview: fn(answering(answer)) },
  }) satisfies Partial<Props>

/** The review panel in the reader, or nothing when none is offered. */
const panel = (root: HTMLElement) => root.querySelector('.workbench__reader .review-panel')

/** The result copy beside the save button. */
const result = (root: HTMLElement) => root.querySelector('.review-panel__result')

/** What the page's polite live region is announcing about the review. */
const announced = (root: HTMLElement) => root.querySelector('.workbench__review-status')

const save = (root: HTMLElement) =>
  within(root).getByRole('button', { name: 'Save review', hidden: false })

/** Picks the category option named `name` in the review radiogroup. */
const pick = (root: HTMLElement, name: string | RegExp) =>
  userEvent.click(within(root).getByRole('radio', { name }))

/** Waits for the result copy to say `text`. */
const resultShows = (root: HTMLElement, text: string | RegExp) =>
  waitFor(() => expect(result(root)).toHaveTextContent(text), { timeout: 3000 })

/** The row whose stored judgment still describes it, so it may be reviewed. */
const reviewableRow = /Can delivery move/

/** The row that may be reviewed, as the queue shows it. */
const reviewedRow = (root: HTMLElement) => within(root).getByRole('button', { name: reviewableRow })

/**
 * The row and the reader both showing the correction a person made, with the
 * model's own suggestion still beside it.
 */
async function showsTheCorrection(root: HTMLElement) {
  await expect(reviewedRow(root)).toHaveTextContent('Suspicious')
  await expect(evidence(root)).toHaveTextContent('Corrected by a person')
  await expect(evidence(root)).toHaveTextContent(`By ${reviewer} on`)
  await expect(evidence(root)).toHaveTextContent('The model suggested Personal')
}

/** Waits for the open row's body to prove its judgment names this version. */
const reviewReady = (root: HTMLElement) =>
  waitFor(() => expect(evidence(root)).toHaveTextContent('Triage current'), { timeout: 3000 })

/** Once the review is offered: chooses `category` and presses Save review. */
async function saveChosen(root: HTMLElement, category: string) {
  await reviewReady(root)
  await pick(root, category)
  await userEvent.click(save(root))
}

/**
 * Confirming one classification. The judgment the open row's body proved
 * current may be reviewed: choosing the category the model chose confirms
 * it. Nothing is saved until Save review is pressed, and what it saves is a
 * review — the copy says the mailbox is unchanged, and never that the
 * message was completed.
 */
export const ReviewConfirm: Story = {
  globals: { viewport: { value: 'desktop', isRotated: false } },
  args: reviewing({ outcome: recorded }),
  play: async ({ args, canvasElement }) => {
    await reviewReady(canvasElement)
    await expect(panel(canvasElement)).toHaveTextContent('Original AI suggestion')

    // Nothing chosen yet: saving is not offered and the copy says so.
    await expect(result(canvasElement)).toHaveTextContent('Choose a category first')
    await expect(save(canvasElement)).toBeDisabled()

    await pick(canvasElement, 'Personal')
    await expect(result(canvasElement)).toHaveTextContent('Not saved yet')
    await expect(save(canvasElement)).toBeEnabled()

    await userEvent.click(save(canvasElement))
    await resultShows(canvasElement, 'Review saved')
    await expect(result(canvasElement)).toHaveTextContent('You confirmed Personal')
    await expect(result(canvasElement)).toHaveTextContent('Your mailbox is unchanged')
    await expect(announced(canvasElement)).toHaveTextContent('Not completed yet')
    await expect(announced(canvasElement)).not.toHaveTextContent(/^Completed/)

    // It named the version the reading showed, and asked for no mailbox action.
    const saveReview = reviewOf(args).onSaveReview
    await expect(saveReview).toHaveBeenCalledTimes(1)
    await expect(saveReview).toHaveBeenCalledWith({
      classification: subjectOf('m1'),
      verdict: { decision: 'confirmed' },
    })
    await expect(
      within(canvasElement).queryByRole('button', { name: 'Complete' }),
    ).not.toBeInTheDocument()
  },
}

/**
 * Correcting one classification. Choosing another category corrects it and
 * keeps the judged priority; the model's own suggestion stays visible beside
 * the result, so what it proposed and what a person made of it both read.
 */
export const ReviewCorrect: Story = {
  globals: { viewport: { value: 'desktop', isRotated: false } },
  args: reviewing({ outcome: recorded }),
  play: async ({ args, canvasElement }) => {
    await saveChosen(canvasElement, 'Suspicious')

    await resultShows(canvasElement, 'Review saved')
    await expect(result(canvasElement)).toHaveTextContent('Category set to Suspicious')
    await expect(result(canvasElement)).toHaveTextContent('The original stays Personal')
    await expect(panel(canvasElement)).toHaveTextContent('Original AI suggestion')
    await expect(reviewOf(args).onSaveReview).toHaveBeenCalledWith({
      classification: subjectOf('m1'),
      // The panel asks about the category, so the judged priority stays.
      verdict: { decision: 'corrected', labels: { category: 'suspicious', priority: 'high' } },
    })
  },
}

/**
 * The store takes a second. While the save is on its way the panel says it
 * is saving and Save review is not offered again; the result arrives after.
 */
export const ReviewPending: Story = {
  globals: { viewport: { value: 'desktop', isRotated: false } },
  args: reviewing({ outcome: recorded, delay: 1000 }),
  play: async ({ args, canvasElement }) => {
    await saveChosen(canvasElement, 'Personal')

    await expect(result(canvasElement)).toHaveTextContent('Saving review')
    await expect(save(canvasElement)).toBeDisabled()
    // Nothing is announced while the answer is still on its way.
    await expect(announced(canvasElement)).toHaveTextContent('')

    await resultShows(canvasElement, 'Review saved')
    await expect(save(canvasElement)).toBeEnabled()
    await expect(reviewOf(args).onSaveReview).toHaveBeenCalledTimes(1)
  },
}

/**
 * A run observed a newer message between the page listing the row and the
 * save arriving, so the store refuses the review as no longer current. The
 * page says nothing was saved and what to do next, and names no message.
 */
export const ReviewStale: Story = {
  globals: { viewport: { value: 'desktop', isRotated: false } },
  args: reviewing({ outcome: { status: 'refused', reason: 'stale_subject' } }),
  play: async ({ canvasElement }) => {
    await saveChosen(canvasElement, 'Personal')

    await resultShows(canvasElement, 'Not saved')
    await expect(result(canvasElement)).toHaveTextContent('no longer the current one')
    await expect(result(canvasElement)).not.toHaveTextContent('Review saved')
    await expect(announced(canvasElement)).toHaveTextContent('Not saved')
    await expect(result(canvasElement)).not.toHaveTextContent('@')
  },
}

/**
 * The store could not be written at all. Nothing was recorded, the page says
 * so without guessing why, and the same review can be tried again.
 */
export const ReviewNotStored: Story = {
  globals: { viewport: { value: 'desktop', isRotated: false } },
  args: reviewing({ outcome: { status: 'failed' } }),
  play: async ({ args, canvasElement }) => {
    await saveChosen(canvasElement, 'Personal')

    await resultShows(canvasElement, 'Not saved')
    await expect(result(canvasElement)).toHaveTextContent('could not be stored')
    await expect(save(canvasElement)).toBeEnabled()
    // Nothing was stored, so nothing about the row changed either.
    await expect(evidence(canvasElement)).toHaveTextContent('Needs a person')

    await userEvent.click(save(canvasElement))
    await waitFor(() => expect(reviewOf(args).onSaveReview).toHaveBeenCalledTimes(2))
  },
}

/**
 * Only a classification that still describes its row may be reviewed. An
 * outdated judgment, a failed attempt and a row nothing triaged all show the
 * evidence they have and no review panel at all, so nobody is asked to
 * decide on a version that has moved on.
 */
export const ReviewOfferedOnlyWhereCurrent: Story = {
  globals: { viewport: { value: 'desktop', isRotated: false } },
  args: reviewing({ outcome: recorded }, storedStates),
  play: async ({ canvasElement }) => {
    const rows = within(canvasElement)
    await waitFor(() => expect(panel(canvasElement)).toBeInTheDocument())

    // The model accepted its own labels here, so the panel waits folded up
    // and still offers the review, named as what it is.
    await expect(panel(canvasElement)).toHaveTextContent('Review this triage')
    await expect(rows.queryByRole('radio', { name: 'Personal' })).not.toBeInTheDocument()
    await userEvent.click(rows.getByRole('button', { name: /^Review this triage/ }))
    await expect(rows.getByRole('radio', { name: 'Personal' })).toBeVisible()

    for (const name of [/Correction on invoice/, /Move Friday dinner\?/, /Newsletter: work/]) {
      await userEvent.click(rows.getByRole('button', { name }))
      await expect(panel(canvasElement)).not.toBeInTheDocument()
    }
    // Back on the row whose judgment holds, the review is offered again.
    await userEvent.click(rows.getByRole('button', { name: reviewableRow }))
    await waitFor(() => expect(panel(canvasElement)).toBeInTheDocument())
  },
}

/**
 * The review is reachable and operable from the keyboard alone: Tab into the
 * panel, arrow keys move within the radiogroup as a radiogroup does, Space
 * chooses and Enter saves. The workbench keys stay out of the way: J and K
 * type nowhere here and never move the list while focus is in the panel.
 */
export const ReviewKeyboard: Story = {
  globals: { viewport: { value: 'desktop', isRotated: false } },
  args: reviewing({ outcome: recorded }),
  play: async ({ args, canvasElement }) => {
    const rows = within(canvasElement)
    await reviewReady(canvasElement)

    // Into the group, choose with Space, then move within it with the arrows.
    const first = rows.getByRole('radio', { name: 'Personal' })
    first.focus()
    await userEvent.keyboard(' ')
    await expect(first).toBeChecked()
    await expect(save(canvasElement)).toBeEnabled()
    await userEvent.keyboard('{ArrowDown}')
    await expect(rows.getByRole('radio', { name: 'Notification' })).toBeChecked()
    await expect(rows.getByRole('radio', { name: 'Notification' })).toHaveFocus()

    // K and J belong to the queue, not to a control the user is typing in.
    await expect(subject(canvasElement)).toHaveTextContent('Can delivery move a week earlier?')
    await userEvent.keyboard('kj')
    await expect(subject(canvasElement)).toHaveTextContent('Can delivery move a week earlier?')

    // Tab to Save review and press it without a pointer.
    await userEvent.tab()
    await expect(save(canvasElement)).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    await resultShows(canvasElement, 'Review saved')
    await expect(reviewOf(args).onSaveReview).toHaveBeenCalledWith({
      classification: subjectOf('m1'),
      verdict: { decision: 'corrected', labels: { category: 'notification', priority: 'high' } },
    })
  },
}

/**
 * The review at 320px: the panel stacks under the body in the reader's one
 * scroll, its options take a single column and Save review fills the width.
 * Nothing scrolls sideways, and the whole flow works on a phone.
 */
export const ReviewMobile: Story = {
  globals: { viewport: { value: 'mobile1', isRotated: false } },
  args: reviewing({ outcome: recorded }),
  play: async ({ canvasElement }) => {
    const rows = within(canvasElement)
    await userEvent.click(rows.getByRole('button', { name: reviewableRow }))
    await waitFor(() => expect(panel(canvasElement)).toBeInTheDocument())

    // The panel sits under the body, inside the region the reader scrolls.
    await expect(content(canvasElement)).toContainElement(panel(canvasElement) as HTMLElement)
    await expect(content(canvasElement).lastElementChild).toHaveClass('message-reader__review')
    await expect(content(canvasElement).scrollWidth).toBeLessThanOrEqual(
      content(canvasElement).clientWidth + 1,
    )

    await pick(canvasElement, 'Personal')
    await userEvent.click(save(canvasElement))
    await resultShows(canvasElement, 'Review saved')
    await expect(result(canvasElement)).toHaveTextContent('Your mailbox is unchanged')
  },
}

/** The reviewer the story's store names, as this computer would name one. */
const reviewer = 'wesley'

/** What the store would hold after one review of m1, as a reading projects it. */
function projected(verdict: DeskReviewRequest['verdict']): RowReview {
  return {
    decidedBy: 'reviewer',
    decision: verdict.decision,
    labels:
      verdict.decision === 'corrected'
        ? verdict.labels
        : { category: unsureLabels.category, priority: unsureLabels.priority },
    reviewer,
    reviewedAt: '2026-09-23T08:30:00.000Z',
  }
}

/**
 * Stands in for the store and the route's loader together: a saved review is
 * kept, and every Refresh hands the page a new reading that carries what the
 * store now holds. Nothing is classified or read again to produce it.
 */
function WithStoredReviews(args: Props) {
  const [reviews, setReviews] = useState<Readonly<Record<string, RowReview>>>({})
  const [count, setCount] = useState(1)
  return (
    <WorkbenchPage
      {...args}
      classifications={{
        reading: `reading-${String(count)}`,
        states: unsureStates,
        reviews,
      }}
      review={{
        mode: 'enabled',
        onSaveReview: (request) => {
          setReviews({ m1: projected(request.verdict) })
          return Promise.resolve(recorded)
        },
      }}
      topBar={{
        ...args.topBar,
        syncActionLabel: 'Refresh mail',
        onSyncClick: () => {
          setCount((current) => current + 1)
        },
      }}
    />
  )
}

const refresh = (root: HTMLElement) =>
  userEvent.click(within(root).getByRole('button', { name: 'Refresh mail' }))

/** Leaves the reviewed row and comes back, so its panel is built afresh. */
async function reopenReviewed(root: HTMLElement) {
  const rows = within(root)
  await userEvent.click(rows.getByRole('button', { name: /Newsletter: work/ }))
  await userEvent.click(rows.getByRole('button', { name: reviewableRow }))
}

/**
 * A correction is read back with the rows it belongs to. After Refresh, and
 * after leaving the row and opening it again, the row still shows the
 * category the person chose, the reader says who decided it and when, and the
 * model's own suggestion is still there beside it. Nothing is classified and
 * no thread is read again to show any of that.
 */
export const ReviewSurvivesRefresh: Story = {
  globals: { viewport: { value: 'desktop', isRotated: false } },
  args: reviewing({ outcome: recorded }),
  render: (args) => <WithStoredReviews {...args} />,
  play: async ({ args, canvasElement }) => {
    const rows = within(canvasElement)
    await saveChosen(canvasElement, 'Suspicious')
    await resultShows(canvasElement, 'Review saved')

    await refresh(canvasElement)
    await showsTheCorrection(canvasElement)
    await expect(evidence(canvasElement)).toHaveTextContent('your mail is unchanged')

    // Built afresh from what the reading carried, not from this session.
    await reopenReviewed(canvasElement)
    await expect(rows.getByRole('radio', { name: 'Suspicious' })).toBeChecked()
    await expect(result(canvasElement)).toHaveTextContent('Review saved')
    // Only the reviewed row moved; the others keep what triage said.
    await expect(rows.getByRole('button', { name: /Correction on invoice/ })).toHaveTextContent(
      'Purchase',
    )
    await expect(args.loadBody).toHaveBeenCalledTimes(3)
  },
}

/**
 * A later confirmation takes effect over the correction before it: the row
 * shows the model's own category again, decided by a person this time. The
 * correction is not undone — the store keeps both — it is simply no longer
 * the latest review of this classification.
 */
export const LaterConfirmationWins: Story = {
  globals: { viewport: { value: 'desktop', isRotated: false } },
  args: reviewing({ outcome: recorded }),
  render: (args) => <WithStoredReviews {...args} />,
  play: async ({ canvasElement }) => {
    const rows = within(canvasElement)
    const reviewed = () => rows.getByRole('button', { name: reviewableRow })
    await saveChosen(canvasElement, 'Suspicious')
    await refresh(canvasElement)
    await expect(reviewed()).toHaveTextContent('Suspicious')

    // Confirming the model's own category, after having corrected it.
    await pick(canvasElement, 'Personal')
    await userEvent.click(save(canvasElement))
    await resultShows(canvasElement, 'You confirmed Personal')
    await refresh(canvasElement)

    await expect(reviewed()).toHaveTextContent('Personal')
    await expect(evidence(canvasElement)).toHaveTextContent('Confirmed by a person')
    await expect(evidence(canvasElement)).toHaveTextContent(
      "A person confirmed the model's suggestion, Personal",
    )
    await reopenReviewed(canvasElement)
    await expect(rows.getByRole('radio', { name: 'Personal' })).toBeChecked()
  },
}

/**
 * A review decides only the row whose classification it named. A reading that
 * carries one for another row leaves this one showing what triage said, and
 * says nobody has reviewed it.
 */
export const ReviewStaysOnItsOwnRow: Story = {
  globals: { viewport: { value: 'desktop', isRotated: false } },
  args: {
    ...reviewing({ outcome: recorded }),
    classifications: {
      reading: 'reading-1',
      states: unsureStates,
      // Another row was reviewed, not this one.
      reviews: { m2: projected({ decision: 'corrected', labels: suspicious }) },
    },
  },
  play: async ({ canvasElement }) => {
    const rows = within(canvasElement)
    await reviewReady(canvasElement)

    await expect(rows.getByRole('button', { name: reviewableRow })).toHaveTextContent('Personal')
    await expect(evidence(canvasElement)).toHaveTextContent('Needs a person')
    await expect(evidence(canvasElement)).not.toHaveTextContent('by a person')
    await expect(result(canvasElement)).toHaveTextContent('Choose a category first')
  },
}

// The same row, judged again by a later run after a reply arrived in its
// thread. It is another version of the same mailbox copy, so a choice made
// about the version before it does not carry over.
const m1Newer: StoredClassification = {
  ...m1Unsure,
  subject: { ...subjectOf('m1'), latestMessageId: '13' },
  judgedAt: '2026-09-23T10:00:00.000Z',
}

const newerStates: Readonly<Record<string, StoredClassification>> = {
  ...storedStates,
  m1: m1Newer,
}

const reviewedSince = projected({ decision: 'corrected', labels: suspicious })

/**
 * Stands in for the route's loader across a refresh that changes something
 * about the open row. Refresh moves to the next reading; the row stays open,
 * so the page is handed new data without the reader being built again.
 */
function WithNextReading({ next, ...args }: Props & { next: ListedEvidence }) {
  const [refreshed, setRefreshed] = useState(false)
  return (
    <WorkbenchPage
      {...args}
      classifications={refreshed ? next : args.classifications}
      topBar={{
        ...args.topBar,
        syncActionLabel: 'Refresh mail',
        onSyncClick: () => {
          setRefreshed(true)
        },
      }}
    />
  )
}

/**
 * A store that records the review and answers with what it now projects for
 * that row, as `storeReview` does. Nothing invents a reviewer or a time here
 * either: this stands in for the store, and the page only ever shows what it
 * was answered.
 */
const recording = (request: DeskReviewRequest): DeskReviewOutcome => ({
  status: 'recorded',
  review: projected(request.verdict),
})

/** The reading a Refresh brings: the same row, judged again since. */
const newerReading: ListedEvidence = { reading: 'reading-2', states: newerStates }

/** The reading a Refresh brings: the same row, reviewed since. */
const reviewedReading: ListedEvidence = {
  reading: 'reading-2',
  states: unsureStates,
  reviews: { m1: reviewedSince },
}

/**
 * A refresh brings another version of the row that is already open, so the
 * reader is never built again. A category chosen about the version before it
 * is not carried over: the panel starts again, and the save that follows
 * names the version now shown rather than pairing it with the old choice.
 */
export const PanelFollowsANewerVersion: Story = {
  globals: { viewport: { value: 'desktop', isRotated: false } },
  args: reviewing({ outcome: recorded }),
  render: (args) => <WithNextReading {...args} next={newerReading} />,
  play: async ({ args, canvasElement }) => {
    const rows = within(canvasElement)
    await reviewReady(canvasElement)
    await pick(canvasElement, 'Suspicious')
    await expect(result(canvasElement)).toHaveTextContent('Not saved yet')

    await refresh(canvasElement)

    // The same row is still open, and the panel is asking again.
    await expect(subject(canvasElement)).toHaveTextContent('Can delivery move a week earlier?')
    await expect(rows.getByRole('radio', { name: 'Suspicious' })).not.toBeChecked()
    await expect(result(canvasElement)).toHaveTextContent('Choose a category first')
    await expect(save(canvasElement)).toBeDisabled()

    await pick(canvasElement, 'Notification')
    await userEvent.click(save(canvasElement))
    await resultShows(canvasElement, 'Review saved')
    await expect(reviewOf(args).onSaveReview).toHaveBeenCalledTimes(1)
    await expect(reviewOf(args).onSaveReview).toHaveBeenCalledWith({
      classification: { ...subjectOf('m1'), latestMessageId: '13' },
      verdict: { decision: 'corrected', labels: { category: 'notification', priority: 'high' } },
    })
  },
}

/**
 * A refresh brings a review stored since the page listed the row, without the
 * row closing. The panel takes it up: the stored category is the one chosen
 * and the result says the review was saved.
 */
export const PanelFollowsAReviewStoredSince: Story = {
  globals: { viewport: { value: 'desktop', isRotated: false } },
  args: reviewing({ outcome: recorded }),
  render: (args) => <WithNextReading {...args} next={reviewedReading} />,
  play: async ({ canvasElement }) => {
    const rows = within(canvasElement)
    await reviewReady(canvasElement)
    await expect(result(canvasElement)).toHaveTextContent('Choose a category first')

    await refresh(canvasElement)

    await expect(rows.getByRole('radio', { name: 'Suspicious' })).toBeChecked()
    await expect(result(canvasElement)).toHaveTextContent('Review saved')
    await expect(evidence(canvasElement)).toHaveTextContent('Corrected by a person')
    await expect(rows.getByRole('button', { name: reviewableRow })).toHaveTextContent('Suspicious')
  },
}

/**
 * A refresh lands while a save is still on its way. The panel is left alone
 * until the answer is in: the request named the version that was shown when
 * it went out, and the store decides that on its own terms. Here it refuses
 * it as no longer current, which is still announced, and only then does the
 * panel start again on the version the refresh brought.
 */
export const RefreshDuringSaveIsLeftAlone: Story = {
  globals: { viewport: { value: 'desktop', isRotated: false } },
  args: reviewing({ outcome: { status: 'refused', reason: 'stale_subject' }, delay: 1000 }),
  render: (args) => <WithNextReading {...args} next={newerReading} />,
  play: async ({ args, canvasElement }) => {
    const rows = within(canvasElement)
    await saveChosen(canvasElement, 'Suspicious')
    await expect(result(canvasElement)).toHaveTextContent('Saving review')

    await refresh(canvasElement)
    // Still saving, and still about what was chosen when it went out.
    await expect(result(canvasElement)).toHaveTextContent('Saving review')
    await expect(rows.getByRole('radio', { name: 'Suspicious' })).toBeChecked()

    await waitFor(() => expect(announced(canvasElement)).toHaveTextContent('Not saved'), {
      timeout: 3000,
    })
    await expect(announced(canvasElement)).toHaveTextContent('no longer the current one')
    // The answer is in, so the panel takes up the version the refresh brought.
    await expect(result(canvasElement)).toHaveTextContent('Choose a category first')
    await expect(rows.getByRole('radio', { name: 'Suspicious' })).not.toBeChecked()
    await expect(reviewOf(args).onSaveReview).toHaveBeenCalledWith({
      classification: subjectOf('m1'),
      verdict: { decision: 'corrected', labels: { category: 'suspicious', priority: 'high' } },
    })
  },
}

/**
 * A saved review shows on the whole page at once. The store answers the save
 * with what it now projects for that row, so the queue shows the category the
 * person chose and the reader names their decision — no refresh, no thread
 * read again and nothing classified to say it. The panel, the row and the
 * evidence never disagree.
 */
export const SavedReviewShowsAtOnce: Story = {
  globals: { viewport: { value: 'desktop', isRotated: false } },
  args: reviewing({ outcome: recording }),
  play: async ({ args, canvasElement }) => {
    await reviewReady(canvasElement)
    await expect(reviewedRow(canvasElement)).toHaveTextContent('Personal')
    await expect(evidence(canvasElement)).toHaveTextContent('Needs a person')

    await pick(canvasElement, 'Suspicious')
    await userEvent.click(save(canvasElement))
    await resultShows(canvasElement, 'Review saved')

    await showsTheCorrection(canvasElement)
    await expect(evidence(canvasElement)).not.toHaveTextContent('Needs a person')

    // It holds for the row in the list once the reader has moved on.
    await userEvent.click(within(canvasElement).getByRole('button', { name: /Newsletter: work/ }))
    await expect(reviewedRow(canvasElement)).toHaveTextContent('Suspicious')
    // Only the two bodies the reader opened were ever asked for.
    await expect(args.loadBody).toHaveBeenCalledTimes(2)
  },
}

/**
 * A review the store refused as no longer current changes nothing on the
 * page: the row keeps the category triage gave it and the reader still says
 * the model asked for a person. Only a review the store recorded shows.
 */
export const RefusedReviewShowsNowhere: Story = {
  globals: { viewport: { value: 'desktop', isRotated: false } },
  args: reviewing({ outcome: { status: 'refused', reason: 'stale_subject' } }),
  play: async ({ canvasElement }) => {
    await saveChosen(canvasElement, 'Suspicious')
    await resultShows(canvasElement, 'Not saved')

    await expect(reviewedRow(canvasElement)).toHaveTextContent('Personal')
    await expect(reviewedRow(canvasElement)).not.toHaveTextContent('Suspicious')
    await expect(evidence(canvasElement)).toHaveTextContent('Needs a person')
    await expect(evidence(canvasElement)).not.toHaveTextContent('by a person')
  },
}

/** The mailbox action panel in the reader, or nothing when none is offered. */
const actionPanel = (root: HTMLElement) =>
  root.querySelector('.workbench__reader .action-proposal-panel')

/** The result copy beside the panel's buttons. */
const actionResult = (root: HTMLElement) => root.querySelector('.action-proposal-panel__result')

/** What the page's polite live region is announcing about the proposal. */
const actionAnnounced = (root: HTMLElement) => root.querySelector('.workbench__action-status')

/** The mailbox copies the proposal names, as the panel lists them. */
const namedCopies = (root: HTMLElement) =>
  [...root.querySelectorAll('.action-proposal-panel__target-label')].map((copy) => copy.textContent)

const press = (root: HTMLElement, name: string) =>
  userEvent.click(within(root).getByRole('button', { name, hidden: false }))

/** A story whose open row may be proposed against, listing `states`. */
const proposing = (states: Readonly<Record<string, StoredClassification>> = storedStates) =>
  ({
    ...classified,
    classifications: reading('reading-1', states),
    loadBody: fn(provingBodies({ m1: m1Current })),
    proposals: { mode: 'enabled', approver: 'you, at this computer' },
  }) satisfies Partial<Props>

/**
 * Proposing one mailbox action, and then approving it. The three stages read
 * apart at every moment: what is proposed, what a person approved, and that
 * execution is blocked. The proposal names the open row's own mailbox copy
 * and no other, and no state ever says a message was archived: nothing here
 * can write to a mailbox at all.
 */
export const ProposeMailboxAction: Story = {
  globals: { viewport: { value: 'desktop', isRotated: false } },
  args: proposing(),
  play: async ({ canvasElement, args }) => {
    await waitFor(() => expect(evidence(canvasElement)).toHaveTextContent('Triage current'))

    // Before anything is proposed, the stages still say where this can go.
    await expect(actionPanel(canvasElement)).toHaveTextContent('Nothing proposed')
    await expect(actionPanel(canvasElement)).toHaveTextContent('Blocked')
    await expect(namedCopies(canvasElement)).toEqual([])

    await press(canvasElement, 'Propose archive')
    await expect(actionPanel(canvasElement)).toHaveTextContent('Waiting for you')
    // Exactly the open row's copy, named. Nothing added an alias copy to it.
    await expect(namedCopies(canvasElement)).toEqual(['Studio Noord · message m1'])
    await expect(actionPanel(canvasElement)).toHaveTextContent(
      'The same message in another mailbox is a separate copy',
    )

    // Approving is its own step, and it moves only the approval stage.
    await press(canvasElement, 'Approve')
    await expect(actionPanel(canvasElement)).toHaveTextContent('Approved by you, at this computer')
    await expect(actionResult(canvasElement)).toHaveTextContent('Approved, not carried out')
    await expect(actionPanel(canvasElement)).toHaveTextContent('Not connected')
    await expect(actionAnnounced(canvasElement)).toHaveTextContent('Your mailbox is unchanged')
    await expect(actionPanel(canvasElement)).not.toHaveTextContent(/archived|completed/i)

    // Nothing was asked of the provider: only the one body the reader opened.
    await expect(args.loadBody).toHaveBeenCalledTimes(1)
    await expect(
      within(canvasElement).queryByRole('button', { name: 'Complete' }),
    ).not.toBeInTheDocument()
  },
}

/**
 * The same page, listing a judgment the store contradicts: a later message
 * reached the thread. Nothing may be proposed against a version that has
 * moved on, so proposing is offered and refused in words rather than being
 * silently absent.
 */
export const NothingToProposeAgainst: Story = {
  globals: { viewport: { value: 'desktop', isRotated: false } },
  args: proposing({ ...storedStates, m1: m1Stale }),
  play: async ({ canvasElement }) => {
    await waitFor(() => expect(actionPanel(canvasElement)).toHaveTextContent('Nothing proposed'))

    await expect(
      within(canvasElement).getByRole('button', { name: 'Propose archive' }),
    ).toBeDisabled()
    await expect(actionPanel(canvasElement)).toHaveTextContent('Blocked')
  },
}

/**
 * A proposal is made against one version of a thread, and a refresh lists a
 * judgment the store now contradicts: a later message reached that thread.
 * The proposal goes out of date and the approval that was given lapses with
 * it, rather than following the row onto a version nobody approved.
 */
function WithMovingThread(args: Props) {
  const [moved, setMoved] = useState(false)
  return (
    <WorkbenchPage
      {...args}
      classifications={reading(
        moved ? 'reading-2' : 'reading-1',
        moved ? { ...storedStates, m1: m1Stale } : storedStates,
      )}
      topBar={{
        ...args.topBar,
        syncActionLabel: 'Refresh mail',
        onSyncClick: () => {
          setMoved(true)
        },
      }}
    />
  )
}

export const ProposalLapsesOnNewerMessage: Story = {
  globals: { viewport: { value: 'desktop', isRotated: false } },
  args: proposing(),
  render: (args) => <WithMovingThread {...args} />,
  play: async ({ canvasElement, args }) => {
    await waitFor(() => expect(evidence(canvasElement)).toHaveTextContent('Triage current'))
    await press(canvasElement, 'Propose archive')
    await press(canvasElement, 'Approve')
    await expect(actionResult(canvasElement)).toHaveTextContent('Approved, not carried out')

    // A refresh lists a judgment the store contradicts: the thread moved on.
    await press(canvasElement, 'Refresh mail')
    await expect(actionPanel(canvasElement)).toHaveTextContent('Out of date')
    await expect(actionPanel(canvasElement)).toHaveTextContent('No longer holds')
    await expect(actionResult(canvasElement)).toHaveTextContent(
      'A later message has reached this thread since',
    )
    // The live region never keeps saying something the panel contradicts.
    await expect(actionAnnounced(canvasElement)).toHaveTextContent('Out of date')
    await expect(actionAnnounced(canvasElement)).not.toHaveTextContent('Approved')
    // The copy it named is still named, and now says where it stands.
    await expect(namedCopies(canvasElement)).toEqual(['Studio Noord · message m1'])
    await expect(within(canvasElement).getByRole('button', { name: 'Approve' })).toBeDisabled()
    // No thread was read again to find that out.
    await expect(args.loadBody).toHaveBeenCalledTimes(1)
  },
}
