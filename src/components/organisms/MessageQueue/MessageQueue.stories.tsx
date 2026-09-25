import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState, type ComponentProps, type ReactNode } from 'react'
import { fn } from 'storybook/test'
import { MessageQueue, type QueueMessage } from './MessageQueue'

type Props = ComponentProps<typeof MessageQueue>

const messages: readonly QueueMessage[] = [
  {
    id: 'm1',
    sender: 'Marit Vos',
    time: '09:42',
    dateTime: '2026-09-21T09:42',
    subject: 'Can delivery move a week earlier?',
    snippet: 'After our meeting I took another look at the planning internally…',
    account: { marker: 'studio', label: 'Studio Noord' },
    status: { label: 'Needs review', tone: 'review' },
    category: 'Customer question',
    unread: true,
  },
  {
    id: 'm2',
    sender: 'Daan Kramer',
    time: '08:17',
    dateTime: '2026-09-21T08:17',
    subject: 'Correction on invoice AL-2048',
    snippet: 'The company name on the invoice is still missing the suffix Ltd.…',
    account: { marker: 'atelier', label: 'Atelier Linden' },
    status: { label: 'Action needed', tone: 'neutral' },
    category: 'Invoice',
    unread: true,
  },
  {
    id: 'm3',
    sender: 'Mila de Jong',
    time: 'Mon',
    subject: 'Move Friday dinner?',
    snippet: 'Would Saturday evening work for you too? Then Koen can…',
    account: { marker: 'personal', label: 'Personal' },
    status: { label: 'To review', tone: 'review' },
    category: 'Personal',
  },
  {
    id: 'm4',
    sender: 'Bureau Kade',
    time: 'Mon',
    subject: 'Newsletter: work that makes room',
    snippet: 'This month we look at three compact workplaces…',
    account: { marker: 'studio', label: 'Studio Noord' },
    status: { label: 'Completed', tone: 'done' },
    category: 'Newsletter',
  },
]

// Ten rounds of the four sample messages, each with its own id.
const manyMessages: readonly QueueMessage[] = Array.from({ length: 10 }, (_, round) =>
  messages.map((message, index) => {
    const n = round * messages.length + index + 1
    return {
      ...message,
      id: `many-${String(n)}`,
      subject: `${message.subject} (${String(n)})`,
      unread: n % 3 === 1,
    }
  }),
).flat()

const longMessages: readonly QueueMessage[] = [
  {
    id: 'long-1',
    sender: 'Municipal Tax Cooperation of the Northern River District and Surroundings',
    time: 'Yesterday',
    subject:
      'Reminder: additional information required for the environmental permit application at 1024 Prinsengracht',
    snippet:
      'Dear sir or madam, following your application we would like to receive the missing construction drawings and structural calculations by Friday at the latest…',
    account: { marker: 'atelier', label: 'Architecture office Atelier Linden & Partners' },
    status: { label: 'Needs review', tone: 'review' },
    category: 'Government correspondence',
    unread: true,
  },
  ...messages,
]

/** A bounded column, like the queue pane in the approved layout. */
function Column({
  width = 400,
  height = 560,
  children,
}: {
  width?: number | undefined
  height?: number | undefined
  children: ReactNode
}) {
  return (
    <div style={{ width, maxWidth: '100%', height, border: '1px solid var(--line)' }}>
      {children}
    </div>
  )
}

type BulkActions = NonNullable<Props['bulkActions']>

const complete = fn()

/** The bar the caller would show for `selected` of `total` visible rows. */
function bulkActions(selected: number, total: number, onSelectAll: (all: boolean) => void) {
  const all = selected > 0 && selected === total
  const bar: BulkActions = {
    label: 'Bulk actions',
    count: 'Select visible results',
    hasSelection: false,
    selectAll: {
      label: 'Select all visible results',
      checked: all,
      indeterminate: selected > 0 && !all,
      onChange: (event) => {
        onSelectAll(event.currentTarget.checked)
      },
    },
  }
  if (selected === 0) return bar
  return {
    ...bar,
    count: `${String(selected)} selected`,
    hasSelection: true,
    context: 'within current filter',
    actions: [
      {
        label: `Complete ${String(selected)}`,
        icon: 'check',
        variant: 'primary',
        onClick: complete,
      },
    ],
  } satisfies BulkActions
}

/** Local state standing in for the app: which row is open and which are checked. */
function Stateful({ width, ...args }: Props & { width?: number | undefined }) {
  const [openId, setOpenId] = useState(args.currentId ?? null)
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set(['m2']))
  const ids = args.messages.map((message) => message.id)
  const selected = ids.filter((id) => checked.has(id)).length
  return (
    <Column width={width}>
      <MessageQueue
        {...args}
        currentId={openId}
        onOpen={(id) => {
          setOpenId(id)
          args.onOpen(id)
        }}
        bulkActions={bulkActions(selected, ids.length, (all) => {
          setChecked(new Set(all ? ids : []))
        })}
        selection={{
          selectedIds: checked,
          label: (message) => `Select ${message.subject}`,
          onChange: (id, isChecked) => {
            setChecked((current) => {
              const next = new Set(current)
              if (isChecked) next.add(id)
              else next.delete(id)
              return next
            })
          },
        }}
      />
    </Column>
  )
}

const meta = {
  title: 'Organisms/Message queue',
  component: MessageQueue,
  args: {
    header: { title: 'Needs review', count: '4 results', context: 'All accounts · current filter' },
    messages,
    currentId: 'm1',
    onOpen: fn(),
  },
  argTypes: {
    header: { control: 'object' },
    messages: { control: 'object' },
    currentId: { control: 'select', options: [null, 'm1', 'm2', 'm3', 'm4'] },
    bulkActions: { control: false },
    selection: { control: false },
    empty: { control: false },
    className: { control: false },
  },
  render: (args) => (
    <Column>
      <MessageQueue {...args} />
    </Column>
  ),
} satisfies Meta<typeof MessageQueue>

export default meta

type Story = StoryObj<typeof meta>

/** Header and rows without bulk selection. The open row carries the accent rule and `aria-current`. */
export const Default: Story = {}

/**
 * With the bulk action bar and row checkboxes, backed by local state. Checking
 * a row never opens it; opening a row never checks it.
 */
export const WithSelection: Story = {
  render: (args) => <Stateful {...args} />,
}

/** Long sender, subject, snippet, account and category end in an ellipsis or wrap. */
export const LongCopy: Story = {
  args: {
    header: {
      title: 'Needs review from every connected account this week',
      count: '5 results',
      context: 'Architecture office Atelier Linden & Partners · Studio Noord · current filter',
    },
    messages: longMessages,
    currentId: 'long-1',
  },
}

/** Forty rows in a 560px column: only the list scrolls, the header stays. */
export const ManyRows: Story = {
  args: {
    header: { title: 'Inbox', count: '40 results' },
    messages: manyMessages,
    currentId: 'many-2',
  },
  render: (args) => <Stateful {...args} />,
}

/**
 * A grouped worklist: every group is a labelled section with a sticky title
 * and its count, an empty group shows its title alone, and each row says why
 * it sits where it does.
 */
const [first, second, third, fourth] = messages as [
  QueueMessage,
  QueueMessage,
  QueueMessage,
  QueueMessage,
]

export const Grouped: Story = {
  args: {
    header: { title: 'Unread', count: '4 results', context: 'All readable mailboxes' },
    groups: [
      {
        id: 'needs_review',
        title: 'Needs review',
        note: '1 of 4 loaded',
        messages: [
          {
            ...first,
            reason:
              'Policy asked for a person. No person has reviewed it. Model advice: Other, Normal.',
          },
        ],
      },
      {
        id: 'high_priority',
        title: 'High priority',
        note: '1 of 4 loaded',
        messages: [
          {
            ...second,
            status: { label: 'Triage from earlier', tone: 'neutral' },
            category: 'Purchase',
            reason: "Purchase, the model's; priority High, the model's.",
          },
        ],
      },
      { id: 'attention', title: 'Attention', note: '0 of 4 loaded', messages: [] },
      {
        id: 'unclassified',
        title: 'Not triaged',
        note: '1 of 4 loaded',
        messages: [
          {
            ...third,
            status: { label: 'Not triaged', tone: 'neutral' },
            category: undefined,
            reason:
              'Not triaged. No run has stored anything for this message, so nothing places it.',
          },
        ],
      },
      {
        id: 'informational',
        title: 'Informational',
        note: '1 of 4 loaded',
        messages: [
          {
            ...fourth,
            status: { label: 'Triage current', tone: 'done' },
            reason:
              "Newsletter, decided by a person; priority Low, the model's. Model advice: Promotion, Low.",
          },
        ],
      },
    ],
    currentId: 'm2',
  },
  render: (args) => <Stateful {...args} />,
}

/** No messages: the caller's `empty` content fills the list area. */
export const EmptySlot: Story = {
  args: {
    header: { title: 'Needs review', count: '0 results', context: 'Studio Noord · current filter' },
    messages: [],
    currentId: null,
    empty: (
      <p
        style={{
          margin: 0,
          padding: 'var(--s8) var(--s5)',
          color: 'var(--muted)',
          textAlign: 'center',
        }}
      >
        No results in this filter.
      </p>
    ),
  },
}

/** A 280px column with bulk selection and long copy, narrower than any phone. */
export const NarrowWidth: Story = {
  args: { ...LongCopy.args, currentId: 'm2' },
  render: (args) => <Stateful {...args} width={280} />,
}
