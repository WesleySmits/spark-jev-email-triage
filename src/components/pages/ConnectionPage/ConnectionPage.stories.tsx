import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import { persistentAfter, type ReconnectSnapshot } from '../../../app/reconnect'
import type { SparkReadiness } from '../../../app/spark-readiness'
import { connectionView } from './connection'
import { ConnectionPage } from './ConnectionPage'
import { useReconnect } from './useReconnect'

// Every story is synthetic: no Spark, no server and no mail. Times are
// fixed so the stories look the same everywhere.
const format = {
  seconds: (at: Date) => at.toISOString().slice(11, 19),
  minutes: (at: Date) => at.toISOString().slice(11, 16),
}

const checked = new Date('2026-09-22T09:41:08Z')

const view = (change: Partial<ReconnectSnapshot> = {}) =>
  connectionView(
    {
      reason: 'failed',
      activity: 'waiting',
      lastChecked: checked,
      failedChecks: 1,
      failingSince: checked,
      offline: false,
      ...change,
    },
    format,
  )

const workflows = [{ id: 'inbox', icon: 'inbox', label: 'Recent mail' }] as const

const meta = {
  title: 'Pages/Connection',
  component: ConnectionPage,
  args: {
    connection: view(),
    onCheckNow: fn(),
    workflows,
    profileLabel: 'Profile',
    profileInitials: 'ME',
  },
  argTypes: {
    connection: { control: 'object' },
    workflows: { control: 'object' },
  },
  parameters: { layout: 'fullscreen' },
  // A bounded frame, like the app's 100dvh root, so the panes scroll.
  decorators: [
    (Story) => (
      <div style={{ height: '100dvh' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ConnectionPage>

export default meta

type Story = StoryObj<typeof meta>

const mobile = { viewport: { value: 'mobile1', isRotated: false } } as const

/** Nothing scrolls sideways, and there is no mail, sample or otherwise. */
async function expectNoMailAndNoOverflow(canvasElement: HTMLElement) {
  const root = canvasElement.ownerDocument.documentElement
  await expect(root.scrollWidth).toBeLessThanOrEqual(root.clientWidth)
  await expect(canvasElement.querySelector('.message-row')).toBeNull()
  await expect(within(canvasElement).getByRole('searchbox')).toBeDisabled()
}

/** Spark is closed or signed out. The workbench stays; the queue pane says what to do. */
export const Waiting: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await expectNoMailAndNoOverflow(canvasElement)
    await expect(canvas.getByRole('heading', { level: 1, name: 'Recent mail' })).toBeVisible()
    await expect(canvas.getByRole('status')).toHaveTextContent('Waiting for Spark')
    await expect(canvas.getByText('Mailboxes appear when Spark answers.')).toBeVisible()
    await expect(canvas.getByText('Your mail opens here')).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'Check now' }))
    await userEvent.click(canvas.getByRole('button', { name: 'Waiting for Spark · 09:41' }))
    await expect(args.onCheckNow).toHaveBeenCalledTimes(2)
  },
}

/** Keyboard: Tab reaches the status, then Check now; J, K and / do nothing without mail. */
export const Keyboard: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.keyboard('/jk')
    await expect(canvas.getByRole('searchbox')).not.toHaveFocus()
    await userEvent.tab()
    await expect(canvas.getByRole('button', { name: 'Waiting for Spark · 09:41' })).toHaveFocus()
    await userEvent.tab()
    await userEvent.tab()
    await expect(canvas.getByRole('button', { name: 'Check now' })).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    await expect(args.onCheckNow).toHaveBeenCalledTimes(1)
  },
}

/** A check runs: the title stays, the action is busy, the dot pulses. */
export const Checking: Story = {
  args: { connection: view({ activity: 'checking' }) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('button', { name: 'Checking…' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    await expect(canvas.getByText('Checking for Spark…')).toBeVisible()
  },
}

/** Spark answered; the one inbox read runs. */
export const Answered: Story = {
  args: { connection: view({ activity: 'loading' }) },
}

/** Spark isn't installed. It is still checked every 10 seconds. */
export const Missing: Story = {
  args: { connection: view({ reason: 'missing' }) },
}

/** The app server stopped answering. It is checked every 10 seconds too. */
export const AppUnavailable: Story = {
  args: { connection: view({ reason: 'unreachable' }) },
}

/** About 5 minutes in: the same 10 seconds, with a since-when and advice. */
export const StillWaiting: Story = {
  args: {
    connection: view({
      failedChecks: persistentAfter,
      failingSince: new Date('2026-09-22T09:36:00Z'),
    }),
  },
}

/** Offline: automatic checks wait for the network. */
export const Offline: Story = {
  args: { connection: view({ offline: true }) },
}

/** Spark's answer couldn't be read safely: no automatic checks, Check now only. */
export const Malformed: Story = {
  args: { connection: view({ reason: 'malformed' }) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expectNoMailAndNoOverflow(canvasElement)
    await expect(canvas.getByText(/Checks only when you ask/)).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Check now' })).toBeVisible()
  },
}

/** Opened from another computer: nothing is checked and nothing can be. */
export const LocalOnly: Story = {
  args: { connection: view({ reason: 'local-only', lastChecked: null }) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expectNoMailAndNoOverflow(canvasElement)
    await expect(canvas.queryByRole('button', { name: /Check/ })).toBeNull()
    await expect(canvas.getByText('Not on the Spark Mac')).toBeVisible()
    await expect(canvas.queryByRole('button', { name: 'Not on the Spark Mac' })).toBeNull()
  },
}

/** At 320px the queue pane is the page; the rail and reader leave. */
export const WaitingMobile: Story = {
  globals: mobile,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expectNoMailAndNoOverflow(canvasElement)
    await expect(canvas.queryByRole('complementary', { name: 'Filters' })).toBeNull()
    const button = canvas.getByRole('button', { name: 'Check now' })
    await expect(button.getBoundingClientRect().height).toBeGreaterThanOrEqual(44)
  },
}

export const CheckingMobile: Story = { ...Checking, globals: mobile }

export const StillWaitingMobile: Story = { ...StillWaiting, globals: mobile }

export const MalformedMobile: Story = { ...Malformed, globals: mobile }

export const LocalOnlyMobile: Story = { ...LocalOnly, globals: mobile }

// ---------------------------------------------------------------------------
// Live stories: the real useReconnect rules against a synthetic probe, with a
// short interval so the timing shows. Nothing is fetched.

const intervalMs = 300

type LiveProps = Readonly<{
  reason: Parameters<typeof useReconnect>[0]['reason']
  probe: (signal: AbortSignal) => Promise<SparkReadiness>
  load: () => Promise<void>
  /** Shows the stand-in inbox once `load` settles, as the route would when mail came. */
  opensInbox?: boolean
}>

type WaitingProps = Omit<LiveProps, 'opensInbox'>

/** The waiting page with the real rules, like the route's Connection. */
function LiveWaiting({ reason, probe, load }: WaitingProps) {
  const { state, checkNow } = useReconnect({ reason, probe, load, intervalMs })
  return (
    <ConnectionPage
      connection={connectionView(state, format)}
      onCheckNow={checkNow}
      workflows={workflows}
      profileLabel="Profile"
      profileInitials="ME"
    />
  )
}

// Stands in for the route: once mail came, the waiting page unmounts, which
// stops its checks, and the inbox shows instead.
function Live({ opensInbox = true, load, ...props }: LiveProps) {
  const [loaded, setLoaded] = useState(false)
  if (loaded) return <p role="status">Inbox loaded</p>
  return (
    <LiveWaiting
      {...props}
      load={async () => {
        await load()
        if (opensInbox) setLoaded(true)
      }}
    />
  )
}

const failed = { status: 'unavailable', reason: 'failed' } as const satisfies SparkReadiness
const ready = { status: 'ready' } as const satisfies SparkReadiness
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

type LiveStory = StoryObj<LiveProps>

/** Whether the synthetic Spark answers, per live story. Reset before each run. */
const reconnecting = { open: false }
const emptyRead = { open: true }

/** Checks at once, then on its own; when Spark answers, the inbox is read exactly once. */
export const ReconnectsWhenSparkAnswers: LiveStory = {
  args: {
    reason: 'failed',
    probe: fn((): Promise<SparkReadiness> => Promise.resolve(reconnecting.open ? ready : failed)),
    load: fn(() => Promise.resolve()),
  },
  beforeEach: () => {
    reconnecting.open = false
  },
  render: (args) => <Live {...args} />,
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await waitFor(() => expect(args.probe).toHaveBeenCalledTimes(2), { timeout: intervalMs * 4 })
    await expect(canvas.getByRole('status')).toHaveTextContent('Waiting for Spark')
    reconnecting.open = true
    await userEvent.click(canvas.getByRole('button', { name: 'Check now' }))
    await waitFor(() => expect(canvas.getByText('Inbox loaded')).toBeVisible())
    await wait(intervalMs * 3)
    await expect(args.load).toHaveBeenCalledTimes(1)
    await expect(args.probe).toHaveBeenCalledTimes(3)
  },
}

/** Clicks during a check don't start another: one request, and focus stays on the button. */
export const ChecksNeverOverlap: LiveStory = {
  args: {
    reason: 'failed',
    probe: fn((): Promise<SparkReadiness> => new Promise(() => undefined)),
    load: fn(() => Promise.resolve()),
  },
  render: (args) => <Live {...args} />,
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const button = await canvas.findByRole('button', { name: 'Checking…' })
    button.focus()
    await userEvent.click(button)
    await userEvent.keyboard('{Enter}')
    window.dispatchEvent(new Event('focus'))
    window.dispatchEvent(new Event('online'))
    await wait(intervalMs * 3)
    await expect(args.probe).toHaveBeenCalledTimes(1)
    await expect(button).toHaveFocus()
    await expect(button).toHaveAttribute('aria-disabled', 'true')
  },
}

/** A story whose page never checks on its own: `answer` is all the probe says. */
const noAutomaticChecks = (
  reason: LiveProps['reason'],
  answer: SparkReadiness,
): Pick<LiveStory, 'args' | 'render'> => ({
  args: {
    reason,
    probe: fn((): Promise<SparkReadiness> => Promise.resolve(answer)),
    load: fn(() => Promise.resolve()),
  },
  render: (args) => <Live {...args} />,
})

/** Focus and time pass without a single check. */
async function expectNoChecks(probe: LiveProps['probe']) {
  window.dispatchEvent(new Event('focus'))
  await wait(intervalMs * 4)
  await expect(probe).not.toHaveBeenCalled()
}

/** Local-only never checks, on its own or otherwise. */
export const LocalOnlyNeverChecks: LiveStory = {
  ...noAutomaticChecks('local-only', failed),
  play: async ({ canvasElement, args }) => {
    await expectNoChecks(args.probe)
    await expect(within(canvasElement).queryByRole('button', { name: /Check/ })).toBeNull()
  },
}

/** Malformed waits for Check now, then checks once. */
export const MalformedChecksOnRequest: LiveStory = {
  ...noAutomaticChecks('malformed', { status: 'unavailable', reason: 'malformed' }),
  play: async ({ canvasElement, args }) => {
    await expectNoChecks(args.probe)
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Check now' }))
    await wait(intervalMs * 4)
    await expect(args.probe).toHaveBeenCalledTimes(1)
  },
}

/**
 * Spark answered but the inbox read still found none: the next check waits a
 * full interval, and the inbox isn't read again until Spark answers again.
 */
export const WaitsAfterAnEmptyRead: LiveStory = {
  args: {
    reason: 'failed',
    probe: fn((): Promise<SparkReadiness> => Promise.resolve(emptyRead.open ? ready : failed)),
    load: fn(() => {
      // Spark goes away again right after this read.
      emptyRead.open = false
      return Promise.resolve()
    }),
    opensInbox: false,
  },
  beforeEach: () => {
    emptyRead.open = true
  },
  render: (args) => <Live {...args} />,
  play: async ({ args }) => {
    await waitFor(() => expect(args.load).toHaveBeenCalledTimes(1))
    await wait(intervalMs / 2)
    await expect(args.probe).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(args.probe).toHaveBeenCalledTimes(2), { timeout: intervalMs * 3 })
    await expect(args.load).toHaveBeenCalledTimes(1)
  },
}
