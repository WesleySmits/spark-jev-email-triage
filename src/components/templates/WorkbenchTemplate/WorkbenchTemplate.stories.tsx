import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState, type ComponentProps, type ReactNode } from 'react'
import { expect, fn, userEvent, within } from 'storybook/test'
import { DisconnectedState } from '../../molecules/DisconnectedState/DisconnectedState'
import DisconnectedStories from '../../molecules/DisconnectedState/DisconnectedState.stories'
import { EmptyState } from '../../molecules/EmptyState/EmptyState'
import { MessageQueue } from '../../organisms/MessageQueue/MessageQueue'
import QueueStories, * as Queue from '../../organisms/MessageQueue/MessageQueue.stories'
import { MessageReader } from '../../organisms/MessageReader/MessageReader'
import * as Reader from '../../organisms/MessageReader/MessageReader.stories'
import { Sidebar } from '../../organisms/Sidebar/Sidebar'
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
  },
  argTypes: {
    topBar: slot(topBars, 'The bar above the workspace, usually a TopBar.'),
    sidebar: slot(sidebars, 'The navigation rail, usually a Sidebar. Hidden at 600px and below.'),
    queue: slot(queues, 'The queue pane, usually a MessageQueue. Hidden at 600px and below.'),
    reader: slot(readers, 'The reader pane. The only pane at 600px and below.'),
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
 * bar leads back, which the caller handles.
 */
export const MobileReader: Story = {
  globals: { viewport: { value: 'mobile1', isRotated: false } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.queryByRole('complementary')).not.toBeInTheDocument()
    await expect(canvas.getByRole('button', { name: 'Back to messages' })).toBeVisible()
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
