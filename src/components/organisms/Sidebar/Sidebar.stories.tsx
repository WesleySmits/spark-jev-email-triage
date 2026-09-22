import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ComponentProps } from 'react'
import { useArgs } from 'storybook/preview-api'
import { fn } from 'storybook/test'
import { Sidebar, type SidebarGroup } from './Sidebar'

type Props = ComponentProps<typeof Sidebar>

const workflow: SidebarGroup = {
  id: 'workflow',
  label: 'Workflow',
  selectedId: 'review',
  items: [
    { id: 'review', icon: 'clock', label: 'Needs review', count: 3 },
    { id: 'action', icon: 'alert', label: 'Needs action', count: 2 },
    { id: 'done', icon: 'check', label: 'Done', count: 0 },
  ],
}

const mailboxes: SidebarGroup = {
  id: 'mailbox',
  label: 'Mailboxes',
  selectedId: 'all',
  items: [
    { id: 'all', icon: 'inbox', label: 'All accounts', count: 6 },
    { id: 'studio', account: 'studio', label: 'Studio Noord', count: 3 },
    { id: 'atelier', account: 'atelier', label: 'Atelier Linden', count: 2 },
    { id: 'personal', account: 'personal', label: 'Personal', count: 1 },
  ],
}

const meta = {
  title: 'Organisms/Sidebar',
  component: Sidebar,
  args: {
    label: 'Filters',
    groups: [workflow, mailboxes],
    shortcuts: [
      { label: 'Next / previous', keys: ['K', 'J'] },
      { label: 'Complete', keys: ['E'] },
    ],
    onSelect: fn(),
  },
  argTypes: {
    label: { control: 'text' },
    groups: { control: 'object' },
    shortcuts: { control: 'object' },
    className: { control: false },
  },
  parameters: { layout: 'fullscreen', frame: { width: 184, height: 560 } },
  // Stands in for the caller: a press moves the group's selectedId in the args.
  render: function Render(args) {
    const [, updateArgs] = useArgs<Props>()
    return (
      <Sidebar
        {...args}
        onSelect={(groupId, itemId) => {
          args.onSelect(groupId, itemId)
          updateArgs({
            groups: args.groups.map((group) =>
              group.id === groupId ? { ...group, selectedId: itemId } : group,
            ),
          })
        }}
      />
    )
  },
  // The app shell owns the rail's size; the source rail is 184px wide.
  decorators: [
    (Story, { parameters }) => {
      const frame = parameters['frame'] as { width: number; height: number }
      return (
        <div style={{ width: frame.width, maxWidth: '100%', height: frame.height }}>
          <Story />
        </div>
      )
    },
  ],
} satisfies Meta<typeof Sidebar>

export default meta

type Story = StoryObj<typeof meta>

/**
 * The approved rail: workflow and mailbox filters with the shortcut legend in
 * a fixed help area. Tab moves through the rows; Enter or Space applies a
 * filter and moves `aria-pressed`. The shown keys do nothing here, because the
 * caller handles them.
 *
 * ```tsx
 * <Sidebar
 *   label="Filters"
 *   groups={[
 *     { id: 'workflow', label: 'Workflow', selectedId: workflow, items: workflowItems },
 *     { id: 'mailbox', label: 'Mailboxes', selectedId: mailbox, items: mailboxItems },
 *   ]}
 *   onSelect={(groupId, itemId) => (groupId === 'workflow' ? setWorkflow(itemId) : setMailbox(itemId))}
 *   shortcuts={[{ label: 'Next / previous', keys: ['K', 'J'] }, { label: 'Complete', keys: ['E'] }]}
 * />
 * ```
 */
export const Default: Story = {}

/** Without shortcuts there is no help area; the groups take the full height. */
export const WithoutShortcuts: Story = { args: { shortcuts: [] } }

/** Long labels truncate with an ellipsis and keep their count; overlines wrap. */
export const LongLabelsAndCounts: Story = {
  args: {
    groups: [
      {
        id: 'workflow',
        label: 'Workflow for the shared support inbox',
        selectedId: 'waiting',
        items: [
          {
            id: 'waiting',
            icon: 'clock',
            label: 'Waiting for a reply from the customer',
            count: 1284,
          },
          {
            id: 'action',
            icon: 'alert',
            label: 'Needs action before the end of the week',
            count: 99999,
          },
          { id: 'done', icon: 'check', label: 'Done', count: 0 },
        ],
      },
      {
        id: 'mailbox',
        label: 'Mailboxes',
        selectedId: null,
        items: [
          { id: 'studio', account: 'studio', label: 'Studio Noord customer service', count: 12045 },
          {
            id: 'atelier',
            account: 'atelier',
            label: 'Atelier Linden invoices and orders',
            count: 312,
          },
        ],
      },
    ],
    shortcuts: [
      { label: 'Next / previous message in the queue', keys: ['K', 'J'] },
      { label: 'Complete', keys: ['E'] },
    ],
  },
}

const accounts = ['studio', 'atelier', 'personal'] as const

/** More rows than fit: the groups scroll, and the help area stays in place. */
export const ManyItems: Story = {
  args: {
    groups: [
      workflow,
      {
        id: 'mailbox',
        label: 'Mailboxes',
        selectedId: 'mailbox-1',
        items: Array.from({ length: 18 }, (_, index) => ({
          id: `mailbox-${String(index + 1)}`,
          account: accounts[index % accounts.length] ?? 'studio',
          label: `Mailbox ${String(index + 1)}`,
          count: (index * 7) % 23,
        })),
      },
    ],
  },
}

/** The source's narrowest rail, 156px, with tighter side padding. */
export const Narrow: Story = {
  parameters: { frame: { width: 156, height: 560 } },
}

/**
 * An empty group shows its `emptyLabel`; without one it is left out, like
 * Labels here.
 */
export const EmptyGroups: Story = {
  args: {
    groups: [
      { ...workflow, items: [], emptyLabel: 'Nothing to triage yet' },
      { ...mailboxes, items: [], emptyLabel: 'No mailboxes connected' },
      { id: 'labels', label: 'Labels', items: [] },
    ],
  },
}
