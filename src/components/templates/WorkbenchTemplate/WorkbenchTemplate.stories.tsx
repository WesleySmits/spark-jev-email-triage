import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState, type ComponentProps, type ReactNode } from 'react'
import { expect, fn, userEvent, within } from 'storybook/test'
import { IconButton } from '../../atoms/IconButton/IconButton'
import { DisconnectedState } from '../../molecules/DisconnectedState/DisconnectedState'
import DisconnectedStories from '../../molecules/DisconnectedState/DisconnectedState.stories'
import { EmptyState } from '../../molecules/EmptyState/EmptyState'
import { FilterSheet } from '../../organisms/FilterSheet/FilterSheet'
import { MessageQueue } from '../../organisms/MessageQueue/MessageQueue'
import QueueStories, * as Queue from '../../organisms/MessageQueue/MessageQueue.stories'
import { MessageReader } from '../../organisms/MessageReader/MessageReader'
import * as Reader from '../../organisms/MessageReader/MessageReader.stories'
import { Sidebar } from '../../organisms/Sidebar/Sidebar'
import SidebarStories, * as Rail from '../../organisms/Sidebar/Sidebar.stories'
import { TopBar } from '../../organisms/TopBar/TopBar'
import TopBarStories, * as Bar from '../../organisms/TopBar/TopBar.stories'
import { compactOnly, WorkbenchTemplate } from './WorkbenchTemplate'

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
    sidebar: slot(sidebars, 'The navigation rail, usually a Sidebar. Hidden at 900px and below.'),
    queue: slot(
      queues,
      'The queue pane, usually a MessageQueue. At 600px and below, one of two panes.',
    ),
    reader: slot(readers, 'The reader pane. At 600px and below, one of two panes.'),
    mobilePane: { control: 'inline-radio', options: ['reader', 'queue'] },
    filters: { control: false },
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

/**
 * A 1024px window, the narrowest that still has a rail: it takes the source's
 * narrowest width, 156px, and the queue its 280px.
 */
export const NarrowDesktop: Story = {
  globals: { viewport: { value: 'narrowDesktop', isRotated: false } },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByRole('complementary', { name: 'Filters' }),
    ).toBeVisible()
  },
}

/**
 * Stands in for a caller at compact widths: the filters button in the top
 * bar opens a sheet holding the very rail the wide layout shows, so there is
 * one set of filters at every width. The template only places the two; the
 * caller owns the state, as the workbench page does.
 */
function CompactSlots(props: Partial<ComponentProps<typeof WorkbenchTemplate>>) {
  const [open, setOpen] = useState(false)
  const close = () => {
    setOpen(false)
  }
  return (
    <WorkbenchTemplate
      mobilePane="queue"
      queue={queues.Messages}
      reader={readers.Message}
      sidebar={sidebars.Default}
      {...props}
      topBar={
        <TopBarSlot
          filters={
            <IconButton
              className={compactOnly}
              icon="filter"
              label="Filters"
              aria-haspopup="dialog"
              aria-expanded={open}
              onClick={() => {
                setOpen(true)
              }}
            />
          }
        />
      }
      filters={
        <FilterSheet label="Filters" open={open} onClose={close}>
          <Sidebar {...SidebarStories.args} onSelect={close} />
        </FilterSheet>
      }
    />
  )
}

/** Opens the filters, checks the rail is inside, and closes them with Escape. */
async function opensAndCloses(root: HTMLElement) {
  const canvas = within(root)
  const button = canvas.getByRole('button', { name: 'Filters' })
  await userEvent.click(button)
  const sheet = canvas.getByRole('dialog', { name: 'Filters' })
  await expect(within(sheet).getByRole('button', { name: /^Needs review/ })).toBeVisible()
  await expect(sheet).toContainElement(document.activeElement as HTMLElement)
  await userEvent.keyboard('{Escape}')
  await expect(canvas.queryByRole('dialog')).not.toBeInTheDocument()
  await expect(button).toHaveFocus()
}

/** Nothing sticks out sideways at this width. */
function fitsTheViewport(root: HTMLElement) {
  return expect(root.scrollWidth).toBeLessThanOrEqual(window.innerWidth)
}

/**
 * A 768px portrait tablet: the rail would leave the reader under 340px, so it
 * goes and both panes stay. The filters are one button away in the top bar.
 */
export const CompactTablet: Story = {
  globals: { viewport: { value: 'tablet768', isRotated: false } },
  render: (args) => <CompactSlots {...args} mobilePane="reader" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.queryByRole('complementary')).not.toBeInTheDocument()
    await expect(canvas.getByRole('main')).toBeVisible()
    await opensAndCloses(canvasElement)
    await fitsTheViewport(canvasElement)
  },
}

/**
 * A 1280px screen at 200% zoom, which is a 640px viewport: still two panes,
 * still no rail, and the filters still reachable.
 */
export const Zoom200: Story = {
  globals: { viewport: { value: 'zoom200', isRotated: false } },
  render: (args) => <CompactSlots {...args} mobilePane="queue" />,
  play: async ({ canvasElement }) => {
    await opensAndCloses(canvasElement)
    await fitsTheViewport(canvasElement)
  },
}

/** The 600px edge: one pane from here down, with the filters over it. */
export const OnePaneEdge: Story = {
  globals: { viewport: { value: 'onePane600', isRotated: false } },
  render: (args) => <CompactSlots {...args} mobilePane="queue" />,
  play: async ({ canvasElement }) => {
    await opensAndCloses(canvasElement)
    await fitsTheViewport(canvasElement)
  },
}

/** A 390px phone: the queue pane with the filters over it. */
export const PhoneFilters: Story = {
  globals: { viewport: { value: 'phone390', isRotated: false } },
  render: (args) => <CompactSlots {...args} mobilePane="queue" />,
  play: async ({ canvasElement }) => {
    await opensAndCloses(canvasElement)
    await fitsTheViewport(canvasElement)
  },
}

/** The narrowest supported width, 320px: the sheet takes 88% of it. */
export const NarrowestFilters: Story = {
  globals: { viewport: { value: 'mobile1', isRotated: false } },
  render: (args) => <CompactSlots {...args} mobilePane="queue" />,
  play: async ({ canvasElement }) => {
    await opensAndCloses(canvasElement)
    await fitsTheViewport(canvasElement)
  },
}

/**
 * The mobile reader at 320px, also what 400% zoom gives on a 1280px screen.
 * The rail and queue leave the layout and the tab order; the reader's mobile
 * bar leads back, which the caller handles by setting `mobilePane` to "queue".
 * Without a `filters` slot there is nothing here that reaches the rail's
 * filters, which is why the workbench page always passes one.
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
