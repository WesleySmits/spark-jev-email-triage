import type { Meta, StoryObj } from '@storybook/react-vite'
import { useEffect, useState, type ComponentProps } from 'react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import QueueStories from '../../organisms/MessageQueue/MessageQueue.stories'
import ReaderStories from '../../organisms/MessageReader/MessageReader.stories'
import SidebarStories from '../../organisms/Sidebar/Sidebar.stories'
import TopBarStories from '../../organisms/TopBar/TopBar.stories'
import { fixtureBodyLoader, type BodyLoader, type InboxFixture } from '../../../app/inbox'
import type { DeskReviewOutcome, DeskReviewRequest, RowReview } from '../../../app/desk-review'
import type { TriageRunSnapshot } from '../../../app/triage-run'
import type {
  ClassificationLabels,
  StoredClassification,
} from '../../../domain/stored-classification'
import type { ReviewReason, SuspicionSignal } from '../../../domain/triage'
import { approveProposal } from '../../../domain/mailbox-action'
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

const completedTriageRun: TriageRunSnapshot = {
  runId: '58c6210a-76d3-4ae2-8910-a36a87005794',
  scope: { kind: 'worklist', label: 'Current worklist' },
  status: 'completed',
  limits: { maxMessages: 4, maxJevCalls: 4 },
  counts: {
    selected: 4,
    processed: 4,
    classified: 3,
    alreadyCurrent: 1,
    providerFailures: 0,
    errors: 0,
    deferred: 0,
  },
  cost: { status: 'price_unavailable', jevCalls: 3, inputTokens: 912, outputTokens: 204 },
  shadowRunIds: [41],
  errorCodes: [],
  startedAt: '2026-09-24T09:42:00.000Z',
  finishedAt: '2026-09-24T09:42:12.000Z',
  items: [
    {
      mailbox: 'studio',
      messageId: 'fictional-message-1',
      status: 'classified',
      category: 'personal',
      priority: 'high',
      needsReview: true,
    },
  ],
}

const completedTriageControl = () => ({
  worklistSize: messages.length,
  state: { phase: 'run' as const, run: completedTriageRun },
  onStart: fn(),
  onResume: fn(),
  onRead: fn(),
  onStop: fn(),
  onRestart: fn(),
  onForget: fn(),
})

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
    triage: { control: 'object' },
    topBar: { control: 'object' },
  },
  parameters: { layout: 'fullscreen' },
  // The shortcut preference lives in this browser's local storage, which every
  // story here shares. Each one starts from the default: the keys on.
  beforeEach: () => {
    localStorage.removeItem(shortcutKey)
  },
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

// Where the page keeps the shortcut preference, as `shortcut-preference.ts` says.
const shortcutKey = 'spark:single-key-shortcuts:v1'

const settingName = 'Single-key shortcuts'

// The rail's shortcut help: the legend rows, if any, and the setting's note.
const shortcutHelp = (root: HTMLElement) =>
  root.querySelector('.shortcut-legend')?.textContent ?? ''

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
  await expect(canvas.getByRole('button', { name: /^All mailboxes/ })).toHaveAttribute(
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

/** The selected Compact workbench with durable Jev result evidence in its queue header. */
export const ManualJevRun: Story = {
  globals: { viewport: { value: 'desktop', isRotated: false } },
  args: {
    triage: completedTriageControl(),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const queue = canvas.getByRole('region', { name: 'Needs review' })
    await expect(within(queue).getByRole('region', { name: 'Jev triage run' })).toBeVisible()
    await expect(within(queue).getByText('Completed')).toBeVisible()
    await expect(canvas.getByRole('main')).toBeVisible()
  },
}

const discoveryScope = {
  view: 'unread',
  query: 'cedar',
  fields: ['sender', 'subject'],
  valuesMayBeTruncated: true,
  pageSize: 10,
  cursor: '11111111-1111-4111-8111-111111111111',
  mailboxes: [
    {
      id: 'studio',
      label: 'studio@mail.example',
      pages: 2,
      scanned: 20,
      matched: 2,
      bounded: true,
    },
    {
      id: 'atelier',
      label: 'atelier@mail.example',
      pages: 2,
      scanned: 18,
      matched: 1,
      bounded: false,
    },
  ],
  failed: [],
  incomplete: [],
  readable: 2,
  scanned: 38,
  matched: 3,
  bounded: true,
  searchedAt: '14:32',
  searchCompletedAt: '2026-09-24T12:32:00.000Z',
} as const

/** Variant C integrated with server-search reach while Feature 2's run control stays intact. */
export const MailboxReachDiscovery: Story = {
  globals: { viewport: { value: 'desktop', isRotated: false } },
  args: {
    messages: messages.slice(0, 3).map((message, index) => ({
      ...message,
      subject: `Cedar result ${String(index + 1)}`,
    })),
    mailboxReach: {
      items: [
        {
          id: 'studio',
          label: 'studio@mail.example',
          account: 'studio',
          pages: 2,
          copies: 20,
          state: 'more',
          lastRead: { label: 'Last searched 14:32', dateTime: '2026-09-24T12:32:00.000Z' },
        },
        {
          id: 'atelier',
          label: 'atelier@mail.example',
          account: 'atelier',
          pages: 2,
          copies: 18,
          state: 'complete',
          lastRead: { label: 'Last searched 14:32', dateTime: '2026-09-24T12:32:00.000Z' },
        },
      ],
      onRetry: fn(),
    },
    discovery: {
      scope: discoveryScope,
      loading: false,
      resetKey: 'reading-1',
      onSearch: fn(),
      onContinue: fn(),
      onClear: fn(),
    },
    triage: completedTriageControl(),
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('heading', { level: 1, name: '“cedar”' })).toBeVisible()
    await expect(canvas.getByRole('region', { name: 'Search reach' })).toHaveTextContent(
      '3 matches · 38 copies scanned',
    )
    await expect(canvas.getByRole('heading', { name: 'Mailbox reach' })).toBeVisible()
    await expect(canvas.queryByRole('navigation', { name: 'Mailboxes' })).toBeNull()
    await expect(canvas.getByRole('region', { name: 'Jev triage run' })).toBeVisible()

    const search = canvas.getByRole('searchbox', { name: 'Search sender and subject' })
    await userEvent.type(search, 'cedar')
    await userEvent.keyboard('{Enter}')
    await expect(args.discovery?.onSearch).toHaveBeenCalledWith('cedar')
    await userEvent.click(canvas.getByRole('button', { name: 'Search further' }))
    await expect(args.discovery?.onContinue).toHaveBeenCalledOnce()

    await userEvent.click(canvas.getByRole('button', { name: /studio@mail\.example/ }))
    await expect(queueContext(canvasElement)).toHaveTextContent('Studio Noord')
    await userEvent.click(canvas.getByRole('button', { name: 'All readable mailboxes' }))
    await expect(queueContext(canvasElement)).toHaveTextContent('All readable mailboxes')
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
    await rail(canvasElement, 'All mailboxes')
    const filter = canvas.getByRole('button', { name: /^All mailboxes/ })
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
 * The keys turned off, as they come back from an earlier visit. No single
 * character acts: K, J, E and / do nothing, and nothing in the page claims
 * they do. Tab, Enter, the buttons and the rows keep working, and the box in
 * the rail turns the keys back on.
 */
export const ShortcutsTurnedOff: Story = {
  globals: { viewport: { value: 'desktop', isRotated: false } },
  beforeEach: () => {
    localStorage.setItem(shortcutKey, 'off')
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const box = canvas.getByRole('checkbox', { name: settingName })
    await expect(box).not.toBeChecked()
    // The help offers no key, and neither does the search or Complete.
    await expect(shortcutHelp(canvasElement)).not.toContain('Next / previous')
    await expect(shortcutHelp(canvasElement)).toContain('Tab, Enter and Escape still work.')
    await expect(canvas.getByRole('searchbox')).not.toHaveAttribute('aria-keyshortcuts')
    await expect(canvas.getByRole('button', { name: 'Complete' })).not.toHaveAttribute(
      'aria-keyshortcuts',
    )

    // K, J and E leave the open message and the focused row as they are.
    const row = canvas.getByRole('button', { name: firstReview })
    await userEvent.click(row)
    await keysChangeNothing(canvasElement, 'kjeKJE', row)
    await expect(canvas.getByRole('button', { name: /^Done/ })).toHaveTextContent('1')
    // / types nowhere and moves no focus.
    blurFocus()
    await userEvent.keyboard('/')
    await expect(canvas.getByRole('searchbox')).not.toHaveFocus()
    await expect(canvas.getByRole('searchbox')).toHaveValue('')

    // Typing still reaches the field, letters and all.
    await userEvent.type(canvas.getByRole('searchbox'), 'kje')
    await expect(canvas.getByRole('searchbox')).toHaveValue('kje')
    await userEvent.clear(canvas.getByRole('searchbox'))

    // Tab reaches the rows and Enter opens one, which is all the page needs.
    row.focus()
    await userEvent.keyboard('{Tab}')
    await expect(row).not.toHaveFocus()
    await userEvent.click(canvas.getByRole('button', { name: lastReview }))
    await expect(subject(canvasElement)).toHaveTextContent('Move Friday dinner?')
    canvas.getByRole('button', { name: firstReview }).focus()
    await userEvent.keyboard('{Enter}')
    await expect(subject(canvasElement)).toHaveTextContent('Can delivery move a week earlier?')

    // Turning the keys back on brings the help and the keys back at once.
    await userEvent.click(box)
    await expect(box).toBeChecked()
    await expect(shortcutHelp(canvasElement)).toContain('Next / previous')
    await expect(canvas.getByRole('searchbox')).toHaveAttribute('aria-keyshortcuts', '/')
    await expect(localStorage.getItem(shortcutKey)).toBe('on')
    blurFocus()
    await userEvent.keyboard('k')
    await expect(subject(canvasElement)).toHaveTextContent('Move Friday dinner?')
  },
}

/**
 * The keys left on, which is how they arrive without a stored choice. The box
 * says so, and the help names every key that acts.
 */
export const ShortcutsTurnedOffAndOnAgain: Story = {
  globals: { viewport: { value: 'desktop', isRotated: false } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const box = canvas.getByRole('checkbox', { name: settingName })
    await expect(box).toBeChecked()
    await expect(shortcutHelp(canvasElement)).toContain('Next / previous')
    await expect(shortcutHelp(canvasElement)).toContain('Complete')

    // Off from here: the choice is stored, so the next visit starts that way.
    await userEvent.click(box)
    await expect(localStorage.getItem(shortcutKey)).toBe('off')
    await expect(shortcutHelp(canvasElement)).not.toContain('Next / previous')
    const row = canvas.getByRole('button', { name: firstReview })
    await userEvent.click(row)
    await keysChangeNothing(canvasElement, 'kj', row)

    // And on again, without a reload in between.
    await userEvent.click(box)
    await expect(localStorage.getItem(shortcutKey)).toBe('on')
    // The box itself keeps its own keys, so the page's act from the row again.
    await keysChangeNothing(canvasElement, 'k', box)
    row.focus()
    await userEvent.keyboard('k')
    await expect(subject(canvasElement)).toHaveTextContent('Move Friday dinner?')
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

// A bounded reading, shaped as the live inbox produces one: it lists every
// readable mailbox up to its mailbox bound, so the three loaded here are the
// bound, and the two beyond it went unread. The story's own bound is 3
// because the sample data has three mailboxes; the app's is 5. The figures
// are counted, never estimated. Synthetic throughout.
const boundedScope: NonNullable<Props['scope']> = {
  mailboxes: [
    { id: 'studio', label: 'studio@mail.example', loaded: 10, bounded: true },
    { id: 'atelier', label: 'atelier@mail.example', loaded: 10, bounded: true },
    { id: 'personal', label: 'personal@mail.example', loaded: 4, bounded: false },
  ],
  failed: [],
  readable: 5,
  mailboxLimit: 3,
  messageLimit: 10,
  loaded: 24,
  bounded: true,
  readAt: '09:42',
  refreshedAt: '2026-09-24T07:42:00.000Z',
}

// The same reading with one mailbox that did not answer. Its rows are the
// only thing missing: the other two mailboxes were read at the same moment
// and are shown in full, and the failed mailbox keeps its place in the rail
// so the filter a person picked is still there. Synthetic throughout.
const partialScope: NonNullable<Props['scope']> = {
  mailboxes: [
    { id: 'studio', label: 'studio@mail.example', loaded: 10, bounded: true },
    // Zero rows because it could not be read, which is why it is in `failed`.
    { id: 'atelier', label: 'atelier@mail.example', loaded: 0, bounded: false },
    { id: 'personal', label: 'personal@mail.example', loaded: 4, bounded: false },
  ],
  failed: [{ id: 'atelier', label: 'atelier@mail.example', reason: 'failed' }],
  readable: 3,
  mailboxLimit: 3,
  messageLimit: 10,
  loaded: 14,
  bounded: true,
  readAt: '09:42',
  refreshedAt: '2026-09-24T07:42:00.000Z',
}

// Every listed mailbox failed: no rows at all, and nothing that says those
// mailboxes are empty.
const noMailboxReadScope: NonNullable<Props['scope']> = {
  mailboxes: partialScope.mailboxes.map((mailbox) => ({ ...mailbox, loaded: 0, bounded: false })),
  failed: partialScope.mailboxes.map(({ id, label }) => ({ id, label, reason: 'failed' as const })),
  readable: 3,
  mailboxLimit: 3,
  messageLimit: 10,
  loaded: 0,
  bounded: false,
  readAt: '09:42',
  refreshedAt: '2026-09-24T07:42:00.000Z',
}

const afterRefresh = (messages: readonly WorkbenchMessage[], refreshed: boolean) =>
  refreshed ? messages.filter((message) => message.id !== 'm1') : messages

const refreshedScope = (
  scope: Props['scope'],
  loaded: number,
  readAt: string,
  refreshedAt: string,
) => scope && { ...scope, loaded, readAt, refreshedAt }

const resetDiscovery = (discovery: Props['discovery'], resetKey: string) =>
  discovery && { ...discovery, scope: undefined, resetKey }

function WithIncrementalRefresh(args: Props) {
  const [state, setState] = useState({ readAt: '09:42', refreshedAt: '2026-09-24T07:42:00.000Z' })
  const nextMessages = afterRefresh(args.messages, state.readAt === '09:47')
  return (
    <WorkbenchPage
      {...args}
      messages={nextMessages}
      scope={refreshedScope(args.scope, nextMessages.length, state.readAt, state.refreshedAt)}
      discovery={resetDiscovery(args.discovery, state.refreshedAt)}
      topBar={{
        ...args.topBar,
        syncLabel: `Loaded unread updated at ${state.readAt} · read only`,
        onSyncClick: () => {
          setState({ readAt: '09:47', refreshedAt: '2026-09-24T07:47:00.000Z' })
        },
      }}
    />
  )
}

// The scope line under the queue title, whatever it says.
const queueScope = (root: HTMLElement) => root.querySelector('.queue-header__scope')

/**
 * A bounded reading: the queue counts loaded rows, and the scope line under
 * the title says which mailboxes were loaded, that the bounds may have cut
 * them, that search covers only loaded mail, and when it was last refreshed.
 */
export const BoundedScope: Story = {
  args: { scope: boundedScope },
  globals: { viewport: { value: 'desktop', isRotated: false } },
  play: async ({ canvasElement }) => {
    const line = queueScope(canvasElement)
    await expect(line).toHaveTextContent(
      'Loaded: 24 recent messages from 3 of 5 readable mailboxes',
    )
    // The two bounds are said apart: skipped mailboxes are missing whole,
    // while the loaded ones were only cut off at their oldest read message.
    await expect(line).toHaveTextContent(
      '2 readable mailboxes were not read at all, so even the newest mail in them is missing',
    )
    await expect(line).toHaveTextContent('Older mail was left out of 2 loaded mailboxes')
    await expect(line).toHaveTextContent('Search and filters cover only loaded mail')
    await expect(line).toHaveTextContent('Last refreshed 09:42')
    await expect(line).toHaveClass('queue-header__scope--bounded')
    // The search says what it searches, so the field claims no whole mailbox.
    await expect(within(canvasElement).getByRole('searchbox')).toHaveAccessibleName(
      'Search loaded mail',
    )
  },
}

/** A refresh removes another row, preserves the open copy and leaves the Jev control mounted. */
export const IncrementalRefreshKeepsSelection: Story = {
  globals: { viewport: { value: 'desktop', isRotated: false } },
  args: {
    scope: boundedScope,
    discovery: {
      loading: false,
      resetKey: '2026-09-24T07:42:00.000Z',
      onSearch: fn(),
      onContinue: fn(),
      onClear: fn(),
    },
    triage: completedTriageControl(),
  },
  render: (args) => <WithIncrementalRefresh {...args} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /Move Friday dinner\?/ }))
    await expect(subject(canvasElement)).toHaveTextContent('Move Friday dinner?')
    await userEvent.type(canvas.getByRole('searchbox'), 'Friday')
    await userEvent.click(canvas.getByRole('button', { name: /Loaded unread updated at 09:42/ }))

    await expect(subject(canvasElement)).toHaveTextContent('Move Friday dinner?')
    await expect(canvas.getByRole('searchbox')).toHaveValue('')
    await expect(canvas.getByRole('region', { name: 'Jev triage run' })).toBeVisible()
    await expect(canvas.getByText('Last refreshed 09:47.')).toBeVisible()
  },
}

/**
 * The same scope at 320px: the queue pane starts open on a phone, so the
 * scope line is there without the rail. The keyboard reaches it and the rows
 * as usual.
 */
export const BoundedScopeOnMobile: Story = {
  args: { scope: boundedScope },
  globals: { viewport: { value: 'mobile1', isRotated: false } },
  play: async ({ canvasElement }) => {
    const line = queueScope(canvasElement)
    await expect(line).toBeVisible()
    await expect(line).toHaveTextContent(
      'Loaded: 24 recent messages from 3 of 5 readable mailboxes',
    )
    await expect(line).toHaveTextContent('Last refreshed 09:42')
    // Tab from the search reaches the queue's rows past the scope line, which
    // is text and takes no focus of its own.
    const canvas = within(canvasElement)
    canvas.getByRole('searchbox').focus()
    await userEvent.tab()
    await expect(document.activeElement).not.toBe(line)
    await openDinnerOnMobile(canvasElement)
    await backToDinnerRow(canvasElement)
  },
}

/**
 * A reading that lost one mailbox. The two that answered are shown in full
 * and counted as two of three, the one that did not is named with no guess
 * about how much it holds, and Refresh is what tries it again. The failure
 * reads as its own problem, not as a bound: nothing says "nothing was cut".
 */
export const PartialMailboxFailure: Story = {
  args: { scope: partialScope },
  globals: { viewport: { value: 'desktop', isRotated: false } },
  play: async ({ canvasElement }) => {
    const line = queueScope(canvasElement)
    // Counted from the mailboxes that answered, so the failed one is not
    // passed off as read.
    await expect(line).toHaveTextContent(
      'Loaded: 14 recent messages from 2 of 3 readable mailboxes',
    )
    await expect(line).toHaveTextContent('1 mailbox could not be read')
    await expect(line).toHaveTextContent('atelier@mail.example')
    await expect(line).toHaveTextContent('How much it holds is unknown. Refresh to try again.')
    // A bound still reads as a bound, and the all-clear is withheld.
    await expect(line).toHaveTextContent('Older mail was left out of 1 loaded mailbox')
    await expect(line).not.toHaveTextContent('nothing was cut')
    // The reading is still dated, so what did arrive is not shown as older
    // than it is and the mail that is missing is not shown at all.
    await expect(line).toHaveTextContent('Last refreshed 09:42')
    // Announced when it appears: a refresh that lost a mailbox changes what
    // the list means without moving focus.
    const canvas = within(canvasElement)
    // Scoped to the scope line: the page has other status regions, e.g. the
    // notice toast, and this is the one the reading owns.
    const announced = canvasElement.querySelector('.queue-header__scope-unread')
    await expect(announced).toHaveAttribute('role', 'status')
    await expect(announced).toHaveTextContent('1 mailbox could not be read')
    // No mail is in the failure: it names the mailbox and nothing it holds.
    await expect(line).not.toHaveTextContent('Move Friday dinner')
    // The line takes no focus, so the keyboard still goes search → rows.
    canvas.getByRole('searchbox').focus()
    await userEvent.tab()
    await expect(document.activeElement).not.toBe(line)
    // The mailbox that failed keeps its filter, so a selection survives it.
    await rail(canvasElement, 'Atelier')
    await expect(queueContext(canvasElement)).toHaveTextContent('Atelier')
  },
}

/**
 * Every listed mailbox failed. That is not an empty mailbox and not a filter
 * that matched nothing, so the queue says which of the three it is and
 * claims nothing about what those mailboxes hold.
 */
export const NoMailboxCouldBeRead: Story = {
  args: { scope: noMailboxReadScope, messages: [] },
  globals: { viewport: { value: 'desktop', isRotated: false } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('No mailbox could be read')).toBeVisible()
    await expect(
      canvas.getByText(/None of the 3 listed mailboxes answered, so this reading holds no mail/),
    ).toBeVisible()
    // It never turns a failure into a claim that the mailboxes are empty.
    await expect(canvas.getByText(/Nothing here says those mailboxes are empty/)).toBeVisible()
    // Resetting filters would bring nothing back, so it is not offered.
    await expect(canvas.queryByRole('button', { name: 'Reset filters' })).toBeNull()
    await expect(queueScope(canvasElement)).toHaveTextContent('No listed mailbox could be read')
  },
}

/**
 * A reading that loaded nothing is not a filter that matched nothing: the
 * empty state says so and offers no Reset, because resetting brings no row
 * back.
 */
export const NothingLoaded: Story = {
  args: {
    messages: [],
    // Three readable mailboxes that each listed nothing: no bound applied.
    scope: {
      ...boundedScope,
      mailboxes: boundedScope.mailboxes.map((mailbox) => ({
        ...mailbox,
        loaded: 0,
        bounded: false,
      })),
      readable: 3,
      loaded: 0,
      bounded: false,
    },
  },
  globals: { viewport: { value: 'desktop', isRotated: false } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('heading', { name: 'No mail loaded' })).toBeVisible()
    await expect(canvas.getByText(/not proof that those mailboxes are empty/)).toBeVisible()
    await expect(canvas.queryByRole('button', { name: 'Reset filters' })).toBeNull()
  },
}

/**
 * A filter that matched nothing keeps its own wording and its Reset, so the
 * two empty states stay apart.
 */
export const FilteredEmptyWithScope: Story = {
  args: { scope: boundedScope },
  globals: { viewport: { value: 'desktop', isRotated: false } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.type(canvas.getByRole('searchbox'), 'zzzz')
    await expect(canvas.getByRole('heading', { name: 'No results in this filter' })).toBeVisible()
    await expect(canvas.getByText(/Only loaded mail is searched/)).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Reset filters' })).toBeVisible()
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
    await expect(queueContext(canvasElement)).toHaveTextContent(/^All readable mailboxes$/)
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

const subjectOf = (id: string) => ({
  copy: { mailboxId: 'studio', messageId: id },
  threadId: `t-${id}`,
  latestMessageId: id,
  rubric: 'email-triage.v2',
  classifierVersion: 'jev-1.13.0',
})

/**
 * Grounds as one run recorded them. No reason at all is what an accepted
 * judgment records; `unknown` is what a record that does not say reads as.
 */
const grounds = (
  reasons: readonly ReviewReason[] = [],
  suspicionSignals: readonly SuspicionSignal[] = [],
): ClassificationLabels['grounds'] => ({ state: 'recorded', reasons, suspicionSignals })

const judgedLabels = {
  category: 'personal',
  priority: 'high',
  confidence: 0.93,
  priorityUncertain: false,
  review: 'auto_accepted',
  reviewPriority: 'normal',
  grounds: grounds(),
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
      grounds: grounds(['low_category_confidence', 'suspicious'], ['payment_redirect']),
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

/** A correction of the category alone, which is all this panel decides. */
const correctedTo = (category: 'suspicious' | 'notification') =>
  ({ category: { decision: 'corrected', value: category } }) as const

// The same judgment of m1, but one the model was unsure of, so its panel
// opens itself. `m1Unverified` keeps the auto-accepted labels, for the story
// that shows what a row the model accepted offers instead.
const unsureLabels = {
  ...judgedLabels,
  confidence: 0.58,
  review: 'needs_review',
  grounds: grounds(['low_category_confidence']),
} as const
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
    review: {
      mode: 'enabled',
      onSaveReview: fn(answering(answer)),
      onCheckReview: fn(() => Promise.resolve({ status: 'unavailable' as const })),
    },
  }) satisfies Partial<Props>

/** The review panel in the reader, or nothing when none is offered. */
const panel = (root: HTMLElement) => root.querySelector('.workbench__reader .review-panel')

/** The result copy beside the save button. */
const result = (root: HTMLElement) => root.querySelector('.review-panel__result')

/** One field's row in the review panel, by the name it carries. */
const fieldRow = (root: HTMLElement, name: string) =>
  root
    .querySelector(`.review-panel [name$="-option"][value="${name}"]`)
    ?.closest('.review-panel__field')

/** What the page's polite live region is announcing about the review. */
const announced = (root: HTMLElement) => root.querySelector('.workbench__review-status')

/**
 * The panel's save button. Its name says how many fields it would record, so
 * it is matched on what every one of those names starts with.
 */
const save = (root: HTMLElement) =>
  within(root).getByRole('button', { name: /^(Save |Check or retry save)/, hidden: false })

/** Tabs until the save button has focus, so the path to it stays keyboard-only. */
async function tabToSave(root: HTMLElement) {
  for (let step = 0; step < 8 && document.activeElement !== save(root); step += 1) {
    await userEvent.tab()
  }
  await expect(save(root)).toHaveFocus()
}

/** Picks the option named `name` in the field's radiogroup. */
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

/** A correction decides the category alone and names the version shown. */
function expectSavedCorrection(
  args: Props,
  classification: DeskReviewRequest['classification'],
  category: 'suspicious' | 'notification',
) {
  return expect(reviewOf(args).onSaveReview).toHaveBeenCalledWith(
    expect.objectContaining({ classification, verdict: correctedTo(category) }),
  )
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
    // The model's advice is stated per field, beside what a person decides.
    await expect(panel(canvasElement)).toHaveTextContent('Model advises')
    await expect(panel(canvasElement)).toHaveTextContent('Your decision')

    // Nothing decided yet: both rows say so, and saving is not offered.
    await expect(result(canvasElement)).toHaveTextContent('Nothing decided yet')
    await expect(panel(canvasElement)).toHaveTextContent('Not reviewed')
    await expect(save(canvasElement)).toBeDisabled()

    // Choosing the value marked as the advice is how it is confirmed, and
    // Save says how many fields it would record before anyone presses it.
    await pick(canvasElement, 'Personal')
    await expect(result(canvasElement)).toHaveTextContent('1 field ready to save')
    await expect(save(canvasElement)).toBeEnabled()
    await expect(save(canvasElement)).toHaveTextContent('Save 1 field')

    await userEvent.click(save(canvasElement))
    await resultShows(canvasElement, 'Review saved')
    await expect(result(canvasElement)).toHaveTextContent('Category confirmed as Personal')
    // The field nobody touched says so, rather than reading as confirmed.
    await expect(result(canvasElement)).toHaveTextContent('The priority stays unreviewed')
    await expect(result(canvasElement)).toHaveTextContent('Your mailbox is unchanged')
    await expect(announced(canvasElement)).toHaveTextContent('Not completed yet')
    await expect(announced(canvasElement)).not.toHaveTextContent(/^Completed/)

    // It named the version the reading showed, and asked for no mailbox action.
    const saveReview = reviewOf(args).onSaveReview
    await expect(saveReview).toHaveBeenCalledTimes(1)
    await expect(saveReview).toHaveBeenCalledWith(
      expect.objectContaining({
        classification: subjectOf('m1'),
        // It confirmed the category and decided nothing else: no priority
        // travels with a choice nobody was asked to make.
        verdict: { category: { decision: 'confirmed' } },
      }),
    )
    await expect(
      within(canvasElement).queryByRole('button', { name: 'Complete' }),
    ).not.toBeInTheDocument()
  },
}

/**
 * Correcting one classification. Choosing another category corrects that
 * field and decides no other; the model's own suggestion stays visible beside
 * the result, so what it proposed and what a person made of it both read.
 */
export const ReviewCorrect: Story = {
  globals: { viewport: { value: 'desktop', isRotated: false } },
  args: reviewing({ outcome: recorded }),
  play: async ({ args, canvasElement }) => {
    await saveChosen(canvasElement, 'Suspicious')

    await resultShows(canvasElement, 'Review saved')
    await expect(result(canvasElement)).toHaveTextContent('Category set to Suspicious')
    await expect(result(canvasElement)).toHaveTextContent("The model's own advice is kept")
    await expect(panel(canvasElement)).toHaveTextContent('Model advises')
    await expectSavedCorrection(args, subjectOf('m1'), 'suspicious')
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
    // What was recorded is no longer pending, so there is nothing to save again.
    await expect(save(canvasElement)).toBeDisabled()
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

    // Tab on to Save, through the row's own undo and the priority group, and
    // press it without a pointer.
    await tabToSave(canvasElement)
    await userEvent.keyboard('{Enter}')
    await resultShows(canvasElement, 'Review saved')
    await expectSavedCorrection(args, subjectOf('m1'), 'notification')
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
function projected(chosen?: RowReview['labels']['category']): RowReview {
  const reviewedAt = '2026-09-23T08:30:00.000Z'
  const decision = chosen === undefined ? 'confirmed' : 'corrected'
  return {
    decidedBy: 'reviewer',
    decision,
    // The panel decides the category, so the priority stays the model's and
    // is no part of what a person decided.
    labels: { category: chosen ?? unsureLabels.category },
    fields: { category: { decision, reviewer, reviewedAt } },
    reviewer,
    reviewedAt,
  }
}

/** The category one request corrected, or nothing where it confirmed one. */
const chosenIn = (verdict: DeskReviewRequest['verdict']) =>
  verdict.category?.decision === 'corrected' ? verdict.category.value : undefined

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
        onCheckReview: () => Promise.resolve({ status: 'unavailable' }),
        onSaveReview: (request) => {
          setReviews({ m1: projected(chosenIn(request.verdict)) })
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
    await expect(evidence(canvasElement)).toHaveTextContent('Your mail is unchanged')

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
    await resultShows(canvasElement, 'Category confirmed as Personal')
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
      reviews: { m2: projected('suspicious') },
    },
  },
  play: async ({ canvasElement }) => {
    const rows = within(canvasElement)
    await reviewReady(canvasElement)

    await expect(rows.getByRole('button', { name: reviewableRow })).toHaveTextContent('Personal')
    await expect(evidence(canvasElement)).toHaveTextContent('Needs a person')
    await expect(evidence(canvasElement)).not.toHaveTextContent('by a person')
    await expect(result(canvasElement)).toHaveTextContent('Nothing decided yet')
  },
}

/**
 * The store recorded the review but answered without its own projection of
 * the row, which the contract allows, and no reading has carried it back yet.
 * The field a person just decided still reads as decided, and says plainly
 * that the store has not confirmed it back; nothing asks to save it again.
 * The queue row keeps the category triage gave it, because nothing has told
 * the page otherwise.
 */
export const SavedWithoutAReadback: Story = {
  globals: { viewport: { value: 'desktop', isRotated: false } },
  args: reviewing({ outcome: recorded }),
  play: async ({ canvasElement }) => {
    await saveChosen(canvasElement, 'Suspicious')
    await resultShows(canvasElement, 'Review saved')

    const row = fieldRow(canvasElement, 'suspicious') as HTMLElement
    await expect(row).toHaveTextContent('Set to Suspicious')
    await expect(row).not.toHaveTextContent('Not reviewed')
    await expect(row).toHaveTextContent('Not read back from the store yet')
    // It is stored, so there is nothing left to save.
    await expect(save(canvasElement)).toBeDisabled()
    // Nothing invented a reviewer or a time for it either.
    await expect(row).not.toHaveTextContent(reviewer)
    await expect(reviewedRow(canvasElement)).toHaveTextContent('Personal')
  },
}

/**
 * The category was decided in an earlier save that the reading carries, and
 * this save decides the priority alone. The result says what it recorded and
 * does not claim the category is unreviewed, because a person decided it.
 */
export const SavingOneFieldLeavesTheOtherDecision: Story = {
  globals: { viewport: { value: 'desktop', isRotated: false } },
  args: {
    ...reviewing({ outcome: recorded }),
    classifications: {
      reading: 'reading-1',
      states: unsureStates,
      reviews: { m1: projected('suspicious') },
    },
  },
  play: async ({ args, canvasElement }) => {
    await reviewReady(canvasElement)
    await expect(fieldRow(canvasElement, 'suspicious')).toHaveTextContent('Set to Suspicious')

    await saveChosen(canvasElement, 'Urgent')

    await resultShows(canvasElement, 'Review saved')
    await expect(result(canvasElement)).toHaveTextContent('Priority set to Urgent')
    await expect(result(canvasElement)).not.toHaveTextContent('unreviewed')
    // The save named the priority and decided nothing about the category.
    await expect(reviewOf(args).onSaveReview).toHaveBeenCalledWith(
      expect.objectContaining({
        verdict: { priority: { decision: 'corrected', value: 'urgent' } },
      }),
    )
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

const reviewedSince = projected('suspicious')

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
  review: projected(chosenIn(request.verdict)),
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
    await expect(result(canvasElement)).toHaveTextContent('1 field ready to save')

    await refresh(canvasElement)

    // The same row is still open, and the panel is asking again.
    await expect(subject(canvasElement)).toHaveTextContent('Can delivery move a week earlier?')
    await expect(rows.getByRole('radio', { name: 'Suspicious' })).not.toBeChecked()
    await expect(result(canvasElement)).toHaveTextContent('Nothing decided yet')
    await expect(save(canvasElement)).toBeDisabled()

    await pick(canvasElement, 'Notification')
    await userEvent.click(save(canvasElement))
    await resultShows(canvasElement, 'Review saved')
    await expect(reviewOf(args).onSaveReview).toHaveBeenCalledTimes(1)
    await expectSavedCorrection(args, { ...subjectOf('m1'), latestMessageId: '13' }, 'notification')
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
    await expect(result(canvasElement)).toHaveTextContent('Nothing decided yet')

    await refresh(canvasElement)

    await expect(rows.getByRole('radio', { name: 'Suspicious' })).toBeChecked()
    await expect(result(canvasElement)).toHaveTextContent('Review saved')
    await expect(evidence(canvasElement)).toHaveTextContent('Corrected by a person')
    await expect(rows.getByRole('button', { name: reviewableRow })).toHaveTextContent('Suspicious')
  },
}

/**
 * A save whose answer was lost, and then a reading that happens to hold
 * exactly what was chosen. The check stays reachable: the uncertain save is
 * still unsettled, and a store that already holds the same decision says
 * nothing about whether this one was recorded.
 */
export const UnknownSaveStaysCheckableAfterARefresh: Story = {
  globals: { viewport: { value: 'desktop', isRotated: false } },
  args: reviewing({ outcome: { status: 'unknown' } }),
  render: (args) => <WithNextReading {...args} next={reviewedReading} />,
  play: async ({ canvasElement }) => {
    await saveChosen(canvasElement, 'Suspicious')
    await waitFor(() => expect(save(canvasElement)).toHaveTextContent('Check or retry save'), {
      timeout: 3000,
    })
    await expect(save(canvasElement)).toBeEnabled()

    await refresh(canvasElement)

    await expect(save(canvasElement)).toHaveTextContent('Check or retry save')
    await expect(save(canvasElement)).toBeEnabled()
    await expect(result(canvasElement)).toHaveTextContent('Save outcome unknown')
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
    await expect(result(canvasElement)).toHaveTextContent('Nothing decided yet')
    await expect(rows.getByRole('radio', { name: 'Suspicious' })).not.toBeChecked()
    await expectSavedCorrection(args, subjectOf('m1'), 'suspicious')
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

const priorityUncertain: StoredClassification = {
  ...m1Unsure,
  labels: { ...unsureLabels, priorityUncertain: true, reviewPriority: 'elevated' },
}
const priorityUncertainStates = { ...unsureStates, m1: priorityUncertain }
const reviewingUncertainPriority = () => ({
  ...reviewing({ outcome: recording }, priorityUncertainStates),
  loadBody: fn(provingBodies({ m1: { ...priorityUncertain, state: 'current' } })),
})

/**
 * Corrects the open row's category to Notification with the keyboard alone and
 * saves it: focus the first option, check the next one with an arrow, tab to
 * Save and press it. Waits until the store's answer shows.
 */
async function correctWithKeyboard(root: HTMLElement) {
  await reviewReady(root)
  const canvas = within(root)
  canvas.getByRole('radio', { name: 'Personal' }).focus()
  await userEvent.keyboard(' {ArrowDown}')
  await expect(canvas.getByRole('radio', { name: 'Notification' })).toBeChecked()
  await tabToSave(root)
  await userEvent.keyboard('{Enter}')
  await resultShows(root, 'Review saved')
}

/** A category correction made with the keyboard leaves the priority uncertain. */
export const CategoryCorrectionKeepsPriorityUncertain: Story = {
  globals: { viewport: { value: 'desktop', isRotated: false } },
  args: reviewingUncertainPriority(),
  play: async ({ args, canvasElement }) => {
    await correctWithKeyboard(canvasElement)

    await expect(evidence(canvasElement)).toHaveTextContent('Category review')
    await expect(evidence(canvasElement)).toHaveTextContent('Corrected by a person')
    await expect(evidence(canvasElement)).toHaveTextContent('The model suggested Personal')
    await expect(evidence(canvasElement)).toHaveTextContent(
      'The model was not sure of this priority.',
    )
    await expect(evidence(canvasElement)).toHaveTextContent('Marked as more urgent to look at.')
    // The save decided the category alone, and the announcement says the
    // priority is still nobody's.
    await expect(announced(canvasElement)).toHaveTextContent('The priority stays unreviewed')
    await expect(reviewedRow(canvasElement)).toHaveTextContent('Notification')
    await expectSavedCorrection(args, subjectOf('m1'), 'notification')
    await expect(args.loadBody).toHaveBeenCalledTimes(1)
  },
}

/** On a narrow screen, confirming the category certifies no other field. */
export const CategoryConfirmationKeepsPriorityUncertain: Story = {
  globals: { viewport: { value: 'mobile1', isRotated: false } },
  args: reviewingUncertainPriority(),
  play: async ({ canvasElement }) => {
    await userEvent.click(reviewedRow(canvasElement))
    await saveChosen(canvasElement, 'Personal')
    await resultShows(canvasElement, 'Review saved')
    await expect(evidence(canvasElement)).toHaveTextContent('Confirmed by a person')
    await expect(evidence(canvasElement)).toHaveTextContent(
      'The model was not sure of this priority.',
    )
    await expect(result(canvasElement)).toHaveTextContent('The priority stays unreviewed')
    await expect(panel(canvasElement)).toHaveTextContent(
      'This panel decides the category and the priority only.',
    )
    await expect(panel(canvasElement)).toHaveTextContent(
      'Whether a reply is expected, and by when, is not confirmed here.',
    )
    await expect(canvasElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth)
  },
}

/** An earlier category review remains historical when the thread has moved on. */
export const OutdatedCategoryReviewKeepsPriorityUncertain: Story = {
  globals: { viewport: { value: 'desktop', isRotated: false } },
  args: {
    ...reviewingUncertainPriority(),
    classifications: {
      ...reading('reading-1', priorityUncertainStates),
      reviews: { m1: projected() },
    },
    loadBody: fn(
      provingBodies({
        m1: { ...priorityUncertain, state: 'stale', reason: 'newer_message' },
      }),
    ),
  },
  play: async ({ args, canvasElement }) => {
    await waitFor(() => expect(evidence(canvasElement)).toHaveTextContent('Triage outdated'))
    await expect(evidence(canvasElement)).toHaveTextContent('Confirmed by a person')
    await expect(evidence(canvasElement)).toHaveTextContent(
      'The model was not sure of this priority.',
    )
    await expect(evidence(canvasElement)).toHaveTextContent(
      'Priority and reply expectations are not confirmed.',
    )
    await expect(panel(canvasElement)).not.toBeInTheDocument()
    await expect(reviewOf(args).onSaveReview).not.toHaveBeenCalled()
  },
}

// Four judgments of the reviewable row that differ only in why a person was
// asked. Each has to read as itself: a score, a mail read as a possible scam,
// several grounds at once, and a record that names none.
type UnverifiedJudgment = Extract<StoredClassification, { state: 'unverified' }>

/** A story reviewing the row, judged on exactly the grounds given. */
const reviewingGrounds = (labels: Partial<ClassificationLabels>) => {
  const asked: UnverifiedJudgment = {
    state: 'unverified',
    subject: subjectOf('m1'),
    judgedAt,
    labels: { ...unsureLabels, ...labels },
  }
  return {
    ...reviewing({ outcome: recording }, { ...unsureStates, m1: asked }),
    loadBody: fn(provingBodies({ m1: { ...asked, state: 'current' as const } })),
  }
}

const scamSuspected: Partial<ClassificationLabels> = {
  reviewPriority: 'elevated',
  grounds: grounds(['suspicious'], ['credential_request']),
}

/** The grounds list in the review panel. */
const groundsShown = (root: HTMLElement) =>
  [...root.querySelectorAll('.review-panel__grounds li')].map((line) => line.textContent)

/**
 * A low category score, explained as the score it is. The panel names one
 * ground, attributes the decision to policy rather than to the model's own
 * account of itself, and warns about nothing, because nothing was flagged.
 */
export const ReviewGroundIsLowScore: Story = {
  globals: { viewport: { value: 'desktop', isRotated: false } },
  args: reviewingGrounds({}),
  play: async ({ canvasElement }) => {
    await reviewReady(canvasElement)
    await expect(groundsShown(canvasElement)).toEqual([
      "The model's score for this category stayed under the level triage accepts on its own.",
    ])
    await expect(panel(canvasElement)).toHaveTextContent("rule over the model's scores")
    await expect(evidence(canvasElement)).toHaveTextContent('Low category score')
    await expect(evidence(canvasElement)).not.toHaveTextContent('Possible scam or phishing')
    // The replaced copy explained every review as the model doubting itself.
    await expect(panel(canvasElement)).not.toHaveTextContent(
      'The model was unsure of this category',
    )
  },
}

/**
 * The same row, asked about because the mail was read as a possible scam. The
 * panel names the signal that fired and the priority policy raised, and the
 * reader carries the warning beside the labels. Nothing quotes the mail.
 */
export const ReviewGroundIsSuspicion: Story = {
  globals: { viewport: { value: 'desktop', isRotated: false } },
  args: reviewingGrounds(scamSuspected),
  play: async ({ canvasElement }) => {
    await reviewReady(canvasElement)
    await expect(groundsShown(canvasElement)).toEqual([
      'Triage read this mail as a possible scam or phishing attempt.',
      'Possible signal: It may ask for a password, a login code or another credential.',
      'Triage raised how urgent a look is, which asks for attention sooner and nothing else.',
    ])
    await expect(evidence(canvasElement)).toHaveTextContent('Possible scam or phishing')
    await expect(evidence(canvasElement)).not.toHaveTextContent('Low category score')
  },
}

/**
 * Several grounds of one judgment, each still its own line: a score, a category
 * nothing fits, the warning, its signals and the raised priority. The reader
 * names them together beside the labels.
 */
export const ReviewGroundsAreSeveral: Story = {
  globals: { viewport: { value: 'desktop', isRotated: false } },
  args: reviewingGrounds({
    category: 'other',
    reviewPriority: 'elevated',
    grounds: grounds(
      ['low_category_confidence', 'ambiguous_category', 'suspicious'],
      ['sender_impersonation', 'payment_redirect'],
    ),
  }),
  play: async ({ canvasElement }) => {
    await reviewReady(canvasElement)
    await expect(groundsShown(canvasElement)).toHaveLength(6)
    await expect(evidence(canvasElement)).toHaveTextContent(
      'Low category score · Answered Other · Possible scam or phishing',
    )
    await expect(evidence(canvasElement)).toHaveTextContent(
      'It may ask to send money or to change payment details.',
    )
  },
}

/**
 * A record from before grounds were recorded. It stays readable: the row, its
 * labels and the panel all show, the panel says the grounds are not there
 * rather than explaining the review as model doubt, and no warning is claimed
 * either way.
 */
export const ReviewGroundsNotRecorded: Story = {
  globals: { viewport: { value: 'desktop', isRotated: false } },
  args: reviewingGrounds({ grounds: { state: 'unknown' } }),
  play: async ({ canvasElement }) => {
    await reviewReady(canvasElement)
    await expect(reviewedRow(canvasElement)).toHaveTextContent('Personal')
    await expect(groundsShown(canvasElement)).toEqual([])
    await expect(panel(canvasElement)).toHaveTextContent('does not say on what grounds')
    await expect(evidence(canvasElement)).toHaveTextContent('Not recorded')
    await expect(evidence(canvasElement)).not.toHaveTextContent('Possible scam or phishing')
    await expect(canvasElement.textContent).not.toMatch(/\bsafe\b/i)
  },
}

/**
 * Correcting the category with the keyboard, on a row flagged as a possible
 * scam. The correction is saved and shown, and the warning is still there:
 * what the mail asked for did not change because someone filed it elsewhere.
 */
export const CategoryCorrectionKeepsTheWarning: Story = {
  globals: { viewport: { value: 'desktop', isRotated: false } },
  args: reviewingGrounds(scamSuspected),
  play: async ({ args, canvasElement }) => {
    await correctWithKeyboard(canvasElement)

    await expect(evidence(canvasElement)).toHaveTextContent('Corrected by a person')
    await expect(evidence(canvasElement)).toHaveTextContent('Possible scam or phishing')
    await expect(evidence(canvasElement)).toHaveTextContent(
      'This stands whatever category a person decides on.',
    )
    // The warning is about the mail, so the row now filed as Notification keeps it.
    await expect(reviewedRow(canvasElement)).toHaveTextContent('Notification')
    await expect(groundsShown(canvasElement)).toContain(
      'Possible signal: It may ask for a password, a login code or another credential.',
    )
    await expectSavedCorrection(args, subjectOf('m1'), 'notification')
  },
}

/** On a narrow screen the grounds stack and the warning still reads in full. */
export const GroundsOnANarrowScreen: Story = {
  globals: { viewport: { value: 'mobile1', isRotated: false } },
  args: reviewingGrounds(scamSuspected),
  play: async ({ canvasElement }) => {
    await userEvent.click(reviewedRow(canvasElement))
    await expect(groundsShown(canvasElement)).toHaveLength(3)
    await expect(evidence(canvasElement)).toHaveTextContent('Possible scam or phishing')
    await expect(canvasElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth)
  },
}

/** The mailbox action panel in the reader, or nothing when none is offered. */
const actionPanel = (root: HTMLElement) =>
  root.querySelector('.workbench__reader .action-proposal-panel')

/** The result copy beside the panel's buttons. */
const actionResult = (root: HTMLElement) => root.querySelector('.action-proposal-panel__result')

/** What the page's polite live region is announcing about the proposal. */
const actionAnnounced = (root: HTMLElement) => root.querySelector('.workbench__action-status')

/** The mailbox copies the proposal names, by the ids the panel shows. */
const namedCopies = (root: HTMLElement) =>
  [...root.querySelectorAll('.action-proposal-panel__target-identity')].map(
    (copy) => copy.textContent,
  )

/** What the panel says the action would change, and what is unknown of it. */
const expectedEffect = (root: HTMLElement) =>
  root.querySelector('.action-proposal-panel__section:has(.action-proposal-panel__effect)')

const press = (root: HTMLElement, name: string) =>
  userEvent.click(within(root).getByRole('button', { name, hidden: false }))

/** A story whose open row may be proposed against, listing `states`. */
const proposing = (states: Readonly<Record<string, StoredClassification>> = storedStates) =>
  ({
    ...classified,
    classifications: reading('reading-1', states),
    loadBody: fn(provingBodies({ m1: m1Current })),
    proposals: {
      mode: 'enabled',
      approver: 'you, at this computer',
      onApprove: (proposal) =>
        Promise.resolve({
          status: 'approved' as const,
          approval: approveProposal(proposal, {
            approvedBy: 'you, at this computer',
            approvedAt: new Date().toISOString(),
          }),
        }),
      onExecute: () => Promise.resolve({ status: 'blocked' as const, reason: 'disabled' as const }),
    },
  }) satisfies Partial<Props>

/**
 * Proposing one mailbox action, and then approving it. The three stages read
 * apart at every moment: what is proposed, what a person approved, and that
 * the separate execution confirmation remains unpressed. All data and
 * callbacks in this story are fictional; no Spark action runs.
 */
export const ProposeMailboxAction: Story = {
  globals: { viewport: { value: 'desktop', isRotated: false } },
  args: proposing(),
  play: async ({ canvasElement, args }) => {
    await waitFor(() => expect(evidence(canvasElement)).toHaveTextContent('Triage current'))

    // Before anything is proposed, the stages still say where this can go.
    await expect(actionPanel(canvasElement)).toHaveTextContent('Nothing proposed')
    await expect(actionPanel(canvasElement)).toHaveTextContent('Waiting')
    await expect(namedCopies(canvasElement)).toEqual([])
    await expect(expectedEffect(canvasElement)).toHaveTextContent(
      'Nothing is proposed, so nothing would change.',
    )

    await press(canvasElement, 'Propose Spark Done')
    await expect(actionPanel(canvasElement)).toHaveTextContent('Waiting for you')
    // Exactly the open row's copy, by the ids a provider would be given.
    // Nothing added an alias copy to it.
    await expect(namedCopies(canvasElement)).toEqual(['studio · message m1'])
    await expect(actionPanel(canvasElement)).toHaveTextContent(
      'Another visible copy may change too',
    )

    // The message ID is Spark's write boundary; the mailbox is context.
    await expect(expectedEffect(canvasElement)).toHaveTextContent('What it would change')
    await expect(expectedEffect(canvasElement)).toHaveTextContent(
      'Spark would mark message ID m1 as Done',
    )
    await expect(expectedEffect(canvasElement)).toHaveTextContent(
      'A new message could arrive between the final check and the action',
    )
    await expect(expectedEffect(canvasElement)).toHaveTextContent(
      'mailbox shown here does not limit Spark',
    )

    // Each precondition names its mailbox id too, so two mailboxes shown
    // under one name could never read as one precondition.
    await expect(actionPanel(canvasElement)).toHaveTextContent(
      'The thread of Studio Noord (studio) still ends at message m1',
    )

    // Approving is its own step, and it moves only the approval stage.
    await press(canvasElement, 'Approve')
    await expect(actionPanel(canvasElement)).toHaveTextContent('Approved by you, at this computer')
    await expect(actionResult(canvasElement)).toHaveTextContent('Approved, not carried out')
    await expect(actionPanel(canvasElement)).toHaveTextContent('Checked on run')
    await expect(actionAnnounced(canvasElement)).toHaveTextContent('Your mailbox is unchanged')
    await expect(actionPanel(canvasElement)).not.toHaveTextContent(/was marked as Done|completed/i)

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
      within(canvasElement).getByRole('button', { name: 'Propose Spark Done' }),
    ).toBeDisabled()
    await expect(actionPanel(canvasElement)).toHaveTextContent('Waiting')
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
    await press(canvasElement, 'Propose Spark Done')
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
    await expect(namedCopies(canvasElement)).toEqual(['studio · message m1'])
    await expect(within(canvasElement).getByRole('button', { name: 'Approve' })).toBeDisabled()
    // No thread was read again to find that out.
    await expect(args.loadBody).toHaveBeenCalledTimes(1)
  },
}

/** Opens the compact filters from the top bar and returns the sheet. */
async function openFilters(root: HTMLElement) {
  await userEvent.click(within(root).getByRole('button', { name: 'Filters' }))
  return within(root).getByRole('dialog', { name: 'Filters' })
}

/**
 * At 320px there is no rail, so the filters sit in the top bar. The sheet
 * holds that same rail with the same counts: there is one filter model, not a
 * mobile copy of it. Choosing applies the filter, closes the sheet, leaves
 * the queue showing and hands focus back to the button that opened it.
 */
export const MobileFilters: Story = {
  globals: { viewport: { value: 'mobile1', isRotated: false } },
  args: readOnly,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.queryByRole('complementary')).not.toBeInTheDocument()
    const button = canvas.getByRole('button', { name: 'Filters' })
    const sheet = await openFilters(canvasElement)
    await expect(within(sheet).getByRole('button', { name: /^Needs review/ })).toHaveTextContent(
      '2',
    )
    await userEvent.click(within(sheet).getByRole('button', { name: /^Personal/ }))
    await expect(canvas.queryByRole('dialog')).not.toBeInTheDocument()
    await expect(button).toHaveFocus()
    await expect(canvas.getByText('1 result')).toBeVisible()
    await expect(queueContext(canvasElement)).toHaveTextContent('Personal')
    await expect(canvasElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth)
  },
}

/**
 * The sheet changes nothing but the filter. At 390px it opens over the
 * reader; Escape leaves the open message exactly as it was. Choosing a
 * mailbox goes back to the list with that message still current, and opening
 * it again reads it.
 */
export const MobileFiltersKeepTheOpenMessage: Story = {
  globals: { viewport: { value: 'phone390', isRotated: false } },
  args: readOnly,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await openDinnerOnMobile(canvasElement)
    const button = canvas.getByRole('button', { name: 'Filters' })
    await userEvent.click(button)
    await userEvent.keyboard('{Escape}')
    await expect(button).toHaveFocus()
    await expect(subject(canvasElement)).toHaveTextContent('Move Friday dinner?')

    const sheet = await openFilters(canvasElement)
    await userEvent.click(within(sheet).getByRole('button', { name: /^Personal/ }))
    await expect(canvas.getByText('1 result')).toBeVisible()
    const row = canvas.getByRole('button', { name: /Move Friday dinner\?/ })
    await expect(row).toHaveAttribute('aria-current', 'true')
    await userEvent.click(row)
    await expect(content(canvasElement)).toHaveFocus()
    await backToDinnerRow(canvasElement)
  },
}

/**
 * A 768px portrait tablet: the rail is gone, so the reader keeps its width,
 * and both panes stay. The keyboard reaches the filters and leaves them the
 * same way as on a phone.
 */
export const CompactTabletFilters: Story = {
  globals: { viewport: { value: 'tablet768', isRotated: false } },
  args: { ...readOnly, scope: boundedScope },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.queryByRole('complementary')).not.toBeInTheDocument()
    // Both panes: the queue's scope line and the reader's body are there.
    await expect(queueScope(canvasElement)).toBeVisible()
    await bodyShows(canvasElement, 'Hi Wesley,')

    // The button opens the sheet from the keyboard, and Tab stays inside it.
    const button = canvas.getByRole('button', { name: 'Filters' })
    button.focus()
    await userEvent.keyboard('{Enter}')
    const sheet = canvas.getByRole('dialog', { name: 'Filters' })
    await userEvent.tab()
    await expect(sheet).toContainElement(document.activeElement as HTMLElement)

    // Closing hands focus back and leaves the open message where it was.
    await userEvent.click(within(sheet).getByRole('button', { name: 'Close filters' }))
    await expect(button).toHaveFocus()
    await expect(subject(canvasElement)).toHaveTextContent('Can delivery move a week earlier?')
    await expect(canvasElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth)
  },
}

/**
 * A 1280px screen at 200% zoom, which is a 640px viewport: two panes without
 * a rail, and the filters one button away. Nothing scrolls sideways.
 */
export const Zoom200: Story = {
  globals: { viewport: { value: 'zoom200', isRotated: false } },
  args: readOnly,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const sheet = await openFilters(canvasElement)
    await userEvent.click(within(sheet).getByRole('button', { name: /^Done/ }))
    await expect(canvas.getByRole('heading', { name: 'Done' })).toBeVisible()
    await expect(canvasElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth)
  },
}

/**
 * At 1280px the rail is the only way to the filters: the compact button
 * leaves the layout and the tab order, so nothing offers the same filters
 * twice.
 */
export const DesktopHasNoFilterButton: Story = {
  globals: { viewport: { value: 'desktop', isRotated: false } },
  args: readOnly,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('complementary', { name: 'Filters' })).toBeVisible()
    await expect(canvas.queryByRole('button', { name: 'Filters' })).not.toBeInTheDocument()
    await expect(canvas.queryByRole('dialog')).not.toBeInTheDocument()
  },
}
