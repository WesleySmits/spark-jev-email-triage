import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { fn } from 'storybook/test'
import { iconNames } from '../../atoms/Icon/Icon'
import { NavigationItem } from './NavigationItem'

const accounts = ['studio', 'atelier', 'personal'] as const

const meta = {
  title: 'Molecules/Navigation item',
  component: NavigationItem,
  args: {
    icon: 'clock',
    label: 'Needs review',
    count: 3,
    active: false,
    disabled: false,
    onClick: fn(),
  },
  argTypes: {
    icon: { control: 'select', options: iconNames },
    account: { control: 'inline-radio', options: accounts },
    label: { control: 'text' },
    count: { control: 'number' },
    active: { control: 'boolean' },
    disabled: { control: 'boolean' },
  },
  // The source rail is 184px wide with 12px padding on a --surface sidebar.
  render: (args) => (
    <div
      style={{ width: 160, maxWidth: '100%', padding: 'var(--s3)', background: 'var(--surface)' }}
    >
      <NavigationItem {...args} />
    </div>
  ),
} satisfies Meta<typeof NavigationItem>

export default meta

type Story = StoryObj<typeof meta>

/** A workflow filter led by a 14px icon. The caller owns `active`. */
export const WithIcon: Story = {
  argTypes: { account: { control: false, table: { disable: true } } },
}

/** A mailbox filter led by the account's 8px marker. */
export const WithAccount: Story = {
  args: { icon: undefined, account: 'studio', label: 'Studio Noord', count: 4 },
  argTypes: { icon: { control: false, table: { disable: true } } },
}

/** The applied filter: `aria-pressed="true"`, tinted surface, indigo text. */
export const Active: Story = {
  args: { active: true },
  argTypes: { account: { control: false, table: { disable: true } } },
}

/** Long labels truncate with an ellipsis; the count stays visible. */
export const LongLabel: Story = {
  args: { label: 'Waiting for a reply from the customer', count: 128 },
  argTypes: { account: { control: false, table: { disable: true } } },
}

/** Disabled rows cannot be focused or activated. */
export const Disabled: Story = {
  args: { disabled: true },
  argTypes: { account: { control: false, table: { disable: true } } },
}

const workflows = [
  { value: 'review', icon: 'clock', label: 'Needs review', count: 3 },
  { value: 'action', icon: 'alert', label: 'Needs action', count: 2 },
  { value: 'done', icon: 'check', label: 'Done', count: 0 },
] as const

const mailboxes = [
  { value: 'studio', label: 'Studio Noord', count: 3 },
  { value: 'atelier', label: 'Atelier Linden', count: 2 },
  { value: 'personal', label: 'Personal', count: 1 },
] as const

type Mailbox = 'all' | (typeof mailboxes)[number]['value']

function Filters() {
  const [workflow, setWorkflow] = useState<(typeof workflows)[number]['value']>('review')
  const [mailbox, setMailbox] = useState<Mailbox>('all')
  return (
    <div
      style={{
        width: 160,
        maxWidth: '100%',
        display: 'grid',
        gap: 'var(--s5)',
        padding: 'var(--s3)',
        background: 'var(--surface)',
      }}
    >
      <nav aria-label="Filter by workflow" style={{ display: 'grid', gap: 2 }}>
        {workflows.map((item) => (
          <NavigationItem
            key={item.value}
            icon={item.icon}
            label={item.label}
            count={item.count}
            active={workflow === item.value}
            onClick={() => {
              setWorkflow(item.value)
            }}
          />
        ))}
      </nav>
      <nav aria-label="Filter by mailbox" style={{ display: 'grid', gap: 2 }}>
        <NavigationItem
          icon="inbox"
          label="All accounts"
          count={6}
          active={mailbox === 'all'}
          onClick={() => {
            setMailbox('all')
          }}
        />
        {mailboxes.map((item) => (
          <NavigationItem
            key={item.value}
            account={item.value}
            label={item.label}
            count={item.count}
            active={mailbox === item.value}
            onClick={() => {
              setMailbox(item.value)
            }}
          />
        ))}
      </nav>
    </div>
  )
}

/**
 * Two filter groups with state, as in the source rail. Tab moves between rows;
 * Enter or Space applies a filter and moves `aria-pressed`.
 *
 * ```tsx
 * <nav aria-label="Filter by mailbox">
 *   <NavigationItem icon="inbox" label="All accounts" count={6} active={mailbox === 'all'} onClick={() => setMailbox('all')} />
 *   {mailboxes.map((item) => (
 *     <NavigationItem
 *       key={item.value}
 *       account={item.value}
 *       label={item.label}
 *       count={item.count}
 *       active={mailbox === item.value}
 *       onClick={() => setMailbox(item.value)}
 *     />
 *   ))}
 * </nav>
 * ```
 */
export const FilterGroups: Story = {
  parameters: { controls: { disable: true } },
  render: () => <Filters />,
}
