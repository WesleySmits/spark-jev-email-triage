import type { Meta, StoryObj } from '@storybook/react-vite'
import {
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
  type RefObject,
} from 'react'
import { expect, fn, userEvent, within } from 'storybook/test'
import { DisconnectedState } from '../../molecules/DisconnectedState/DisconnectedState'
import DisconnectedStories from '../../molecules/DisconnectedState/DisconnectedState.stories'
import { EmptyState } from '../../molecules/EmptyState/EmptyState'
import { MessageQueue, type QueueMessage } from '../../organisms/MessageQueue/MessageQueue'
import QueueStories, * as Queue from '../../organisms/MessageQueue/MessageQueue.stories'
import { MessageReader } from '../../organisms/MessageReader/MessageReader'
import * as Reader from '../../organisms/MessageReader/MessageReader.stories'
import { Sidebar, type SidebarGroup } from '../../organisms/Sidebar/Sidebar'
import SidebarStories, * as Rail from '../../organisms/Sidebar/Sidebar.stories'
import { TopBar } from '../../organisms/TopBar/TopBar'
import TopBarStories, * as Bar from '../../organisms/TopBar/TopBar.stories'
import { WorkbenchTemplate } from './WorkbenchTemplate'

// The slots reuse the merged organisms' story args, so the workbench shows
// exactly what their own stories show. Callbacks only log.

type TopBarProps = ComponentProps<typeof TopBar>
type ReaderProps = ComponentProps<typeof MessageReader>

/** Stands in for the caller's query state, so the search field can be typed in. */
function TopBarSlot(props: Partial<TopBarProps>) {
  const args = { ...TopBarStories.args, ...props }
  const [query, setQuery] = useState(args.searchValue)
  return <TopBar {...args} searchValue={query} onSearchChange={setQuery} />
}

/** What a caller does with plain text: one paragraph per blank line. */
function ReaderSlot({ children, ...props }: Partial<ReaderProps>) {
  const args = { ...Reader.default.args, ...props }
  const text = typeof children === 'string' ? children : Reader.default.args.children
  return (
    <MessageReader {...args}>
      {text.split(/\n{2,}/).map((paragraph, index) => (
        <p key={index}>{paragraph}</p>
      ))}
    </MessageReader>
  )
}

const mobileBar = Reader.Mobile.args?.mobileBar

const topBars = {
  Connected: <TopBarSlot />,
  Disconnected: <TopBarSlot {...Bar.Disconnected.args} />,
  'Long Dutch copy': <TopBarSlot {...Bar.LongDutchCopy.args} />,
}

const sidebars = {
  Default: <Sidebar {...SidebarStories.args} />,
  'Long labels': <Sidebar {...SidebarStories.args} {...Rail.LongLabelsAndCounts.args} />,
  'Many items': <Sidebar {...SidebarStories.args} {...Rail.ManyItems.args} />,
}

const queues = {
  Messages: <MessageQueue {...QueueStories.args} />,
  'Long copy, many rows': (
    <MessageQueue
      {...QueueStories.args}
      {...Queue.LongCopy.args}
      messages={[
        ...(Queue.LongCopy.args?.messages ?? []),
        ...(Queue.ManyRows.args?.messages ?? []),
      ]}
    />
  ),
  Empty: (
    <MessageQueue
      {...QueueStories.args}
      {...Queue.EmptySlot.args}
      empty={
        <EmptyState
          headingLevel={3}
          icon="inbox"
          title="No results in this filter"
          description="Choose another queue or mailbox."
          action={{ label: 'Show all mailboxes', onClick: fn() }}
        />
      }
    />
  ),
}

const readers = {
  Message: <ReaderSlot mobileBar={mobileBar} />,
  Review: <ReaderSlot {...Reader.Review.args} mobileBar={mobileBar} />,
  'Long safe text': <ReaderSlot {...Reader.LongSafeText.args} mobileBar={mobileBar} />,
  'Nothing open': (
    <EmptyState
      icon="inbox"
      title="No message open"
      description="Choose a message in the list to read it here."
    />
  ),
  Disconnected: <DisconnectedState {...DisconnectedStories.args} />,
}

function slot(options: Record<string, ReactNode>, description: string) {
  return {
    control: 'select',
    options: Object.keys(options),
    mapping: options,
    description,
  } as const
}

const meta = {
  title: 'Templates/Workbench',
  component: WorkbenchTemplate,
  args: {
    topBar: 'Connected',
    sidebar: 'Default',
    queue: 'Messages',
    reader: 'Message',
    mobilePane: 'reader',
  },
  argTypes: {
    topBar: slot(topBars, 'The bar above the workspace, usually a TopBar.'),
    sidebar: slot(sidebars, 'The navigation rail, usually a Sidebar. Hidden at 600px and below.'),
    queue: slot(
      queues,
      'The queue pane, usually a MessageQueue. At 600px and below, one of two panes.',
    ),
    reader: slot(readers, 'The reader pane. At 600px and below, one of two panes.'),
    mobilePane: { control: 'inline-radio', options: ['reader', 'queue'] },
    className: { control: false },
  },
  parameters: { layout: 'fullscreen' },
  // A bounded frame, like the caller's 100dvh root, so the panes scroll.
  decorators: [
    (Story) => (
      <div style={{ height: '100dvh' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof WorkbenchTemplate>

export default meta

type Story = StoryObj<typeof meta>

/**
 * The approved desktop workbench at 1280px: top bar, 184px rail, bounded
 * queue and the reader taking the rest. Each pane scrolls on its own; the
 * page does not. Tab runs top bar, rail, queue, then reader. Pick other
 * slots in Controls.
 *
 * ```tsx
 * <div style={{ height: '100dvh' }}>
 *   <WorkbenchTemplate
 *     topBar={<TopBar {...topBar} />}
 *     sidebar={<Sidebar {...sidebar} />}
 *     queue={<MessageQueue {...queue} />}
 *     reader={<MessageReader {...reader} mobileBar={mobileBar}>{paragraphs}</MessageReader>}
 *   />
 * </div>
 * ```
 */
export const Desktop: Story = {
  globals: { viewport: { value: 'desktop', isRotated: false } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('banner')).toBeVisible()
    await expect(canvas.getByRole('complementary', { name: 'Filters' })).toBeVisible()
    await expect(canvas.getByRole('main')).toBeVisible()
    await userEvent.tab()
    await expect(canvas.getByRole('searchbox')).toHaveFocus()
  },
}

/** An 834px desktop window: the rail narrows to 156px and the queue to 280px. */
export const NarrowDesktop: Story = {
  globals: { viewport: { value: 'tablet', isRotated: false } },
}

/**
 * The mobile reader at 320px, also what 400% zoom gives on a 1280px screen.
 * The rail and queue leave the layout and the tab order; the reader's mobile
 * bar leads back, which the caller handles by setting `mobilePane` to "queue".
 */
export const MobileReader: Story = {
  globals: { viewport: { value: 'mobile1', isRotated: false } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.queryByRole('complementary')).not.toBeInTheDocument()
    await expect(canvas.getByRole('button', { name: 'Back to messages' })).toBeVisible()
  },
}

/** The mobile queue at 320px: the caller sets `mobilePane` to "queue", so the list shows instead of the reader. */
export const MobileQueue: Story = {
  args: { mobilePane: 'queue' },
  globals: { viewport: { value: 'mobile1', isRotated: false } },
}

// Interactive: a stand-in for the page that will own this state. It filters
// the sample messages by workflow, mailbox and query, opens rows in the
// reader, switches the mobile pane and moves focus with it. Nothing is
// fetched or changed; the reader shows each row's snippet as its body.

type Filter = Readonly<{ workflow: string; mailbox: string; query: string }>
type Pane = ComponentProps<typeof WorkbenchTemplate>['mobilePane']

const sampleMessages = QueueStories.args.messages
const [workflowGroup] = SidebarStories.args.groups
const initialFilter: Filter = { workflow: 'review', mailbox: 'all', query: '' }

const inWorkflow: Record<string, (message: QueueMessage) => boolean> = {
  review: (message) => message.status.tone === 'review',
  action: (message) => message.status.label === 'Action needed',
  done: (message) => message.status.tone === 'done',
}

const inMailbox = (message: QueueMessage, mailbox: string) =>
  mailbox === 'all' || message.account.marker === mailbox

const hasText = (message: QueueMessage, query: string) =>
  [message.sender, message.subject, message.snippet].some((text) =>
    text.toLowerCase().includes(query.trim().toLowerCase()),
  )

function matches(message: QueueMessage, { workflow, mailbox, query }: Filter) {
  const workflowMatch = inWorkflow[workflow] ?? (() => true)
  return workflowMatch(message) && inMailbox(message, mailbox) && hasText(message, query)
}

function workflowLabel(id: string) {
  return workflowGroup?.items.find((item) => item.id === id)?.label ?? ''
}

/** The rail with the applied filters and counts from the sample messages. */
function railGroups(filter: Filter): SidebarGroup[] {
  const count = (change: Partial<Filter>) =>
    sampleMessages.filter((message) => matches(message, { ...filter, ...change, query: '' })).length
  const selected: Record<string, string> = { workflow: filter.workflow, mailbox: filter.mailbox }
  return SidebarStories.args.groups.map((group) => ({
    ...group,
    selectedId: selected[group.id],
    items: group.items.map((item) => ({ ...item, count: count({ [group.id]: item.id }) })),
  }))
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join('')
}

/** The page state this story stands in for: filters, the open row and the mobile pane. */
function useWorkbenchState() {
  const [filter, setFilter] = useState(initialFilter)
  const [openId, setOpenId] = useState<string | null>('m1')
  const [pane, setPane] = useState<Pane>('queue')
  const shown = sampleMessages.filter((message) => matches(message, filter))
  const open = shown.find((message) => message.id === openId)
  return {
    filter,
    shown,
    open,
    pane: open ? pane : 'queue',
    update: (change: Partial<Filter>) => {
      setFilter({ ...filter, ...change })
      setPane('queue')
    },
    openMessage: (id: string) => {
      setOpenId(id)
      setPane('reader')
    },
    back: () => {
      setPane('queue')
    },
  } as const
}

type WorkbenchState = ReturnType<typeof useWorkbenchState>

const focusTarget: Record<Pane, string> = {
  reader: '.workbench__reader [role="region"][tabindex]',
  queue: '.workbench__queue [aria-current="true"]',
}

function focusIsHidden() {
  const active = document.activeElement
  return active instanceof HTMLElement && !active.checkVisibility()
}

/**
 * After a mobile pane switch the focused control is hidden. Moves focus to
 * the reader's content, or back to the open row in the queue.
 */
function useFocusShownPane(root: RefObject<HTMLDivElement | null>, pane: Pane) {
  useEffect(() => {
    if (!focusIsHidden()) return
    root.current?.querySelector<HTMLElement>(focusTarget[pane])?.focus()
  }, [root, pane])
}

function InteractiveQueue({ state }: Readonly<{ state: WorkbenchState }>) {
  const { shown, open, filter, update, openMessage } = state
  return (
    <MessageQueue
      header={{
        title: workflowLabel(filter.workflow),
        count: `${String(shown.length)} ${shown.length === 1 ? 'result' : 'results'}`,
        context: 'Sample data · current filter',
      }}
      messages={shown}
      currentId={open?.id}
      onOpen={openMessage}
      empty={
        <EmptyState
          headingLevel={3}
          icon="inbox"
          title="No results in this filter"
          description="Choose another workflow or mailbox, or clear the search."
          action={{
            label: 'Reset filters',
            onClick: () => {
              update(initialFilter)
            },
          }}
        />
      }
    />
  )
}

function InteractiveReader({ state }: Readonly<{ state: WorkbenchState }>) {
  const { shown, open, filter, back } = state
  if (!open) return readers['Nothing open']
  const position = `${String(shown.indexOf(open) + 1)} of ${String(shown.length)} in ${workflowLabel(filter.workflow)}`
  return (
    <ReaderSlot
      header={{
        subject: open.subject,
        headingLevel: 2,
        status: open.status,
        sender: {
          name: open.sender,
          initials: initials(open.sender),
          account: open.account,
          time: open.time,
          dateTime: open.dateTime,
        },
      }}
      mobileBar={{ title: open.account.label, context: position, onBack: back }}
    >
      {open.snippet}
    </ReaderSlot>
  )
}

function InteractiveStory(args: ComponentProps<typeof WorkbenchTemplate>) {
  const state = useWorkbenchState()
  const root = useRef<HTMLDivElement>(null)
  useFocusShownPane(root, state.pane)
  return (
    <div ref={root} style={{ height: '100%' }}>
      <WorkbenchTemplate
        {...args}
        mobilePane={state.pane}
        topBar={
          <TopBar
            {...TopBarStories.args}
            searchValue={state.filter.query}
            onSearchChange={(query) => {
              state.update({ query })
            }}
          />
        }
        sidebar={
          <Sidebar
            {...SidebarStories.args}
            groups={railGroups(state.filter)}
            onSelect={(groupId, itemId) => {
              state.update({ [groupId]: itemId })
            }}
          />
        }
        queue={<InteractiveQueue state={state} />}
        reader={<InteractiveReader key={state.open?.id} state={state} />}
      />
    </div>
  )
}

const interactive = {
  argTypes: {
    topBar: { table: { disable: true } },
    sidebar: { table: { disable: true } },
    queue: { table: { disable: true } },
    reader: { table: { disable: true } },
    mobilePane: { table: { disable: true } },
  },
  render: (args) => <InteractiveStory {...args} />,
} satisfies Story

/**
 * Click through it like the app: pick a workflow or mailbox in the rail,
 * search in the top bar, and open a message in the reader. The queue, reader
 * and rail counts follow; the counts leave the search out. "Reset filters" in
 * an empty queue starts over. The state lives in this story as a stand-in for
 * the page: nothing is fetched, archived or sent, and the shown keyboard
 * shortcuts do nothing.
 */
export const Interactive: Story = {
  ...interactive,
  globals: { viewport: { value: 'desktop', isRotated: false } },
}

/**
 * The same at 320px. It starts on the queue; opening a row shows the reader
 * and moves focus to its content, and the back button returns to the queue
 * with focus on that row.
 */
export const InteractiveMobile: Story = {
  ...interactive,
  globals: { viewport: { value: 'mobile1', isRotated: false } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /Move Friday dinner\?/ }))
    await expect(canvas.getByRole('region', { name: 'Message content' })).toHaveFocus()
    await userEvent.click(canvas.getByRole('button', { name: 'Back to messages' }))
    await expect(canvas.getByRole('button', { name: /Move Friday dinner\?/ })).toHaveFocus()
  },
}

/**
 * Long Dutch copy, long labels, many rows and a long message. Everything
 * wraps or truncates in its pane; nothing scrolls sideways.
 */
export const LongContent: Story = {
  args: {
    topBar: 'Long Dutch copy',
    sidebar: 'Many items',
    queue: 'Long copy, many rows',
    reader: 'Long safe text',
  },
}

/** An empty filter and no message open: the slots take empty states. */
export const EmptySlots: Story = {
  args: { queue: 'Empty', reader: 'Nothing open' },
}

/**
 * Spark is unavailable: the top bar says so, the queue keeps the last read
 * rows, and the reader shows the recovery panel.
 */
export const Disconnected: Story = {
  args: { topBar: 'Disconnected', reader: 'Disconnected' },
}
