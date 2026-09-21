import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'
import { BulkActionBar } from './BulkActionBar'

const meta = {
  title: 'Molecules/Bulk action bar',
  component: BulkActionBar,
  args: {
    label: 'Bulk actions',
    count: '3 results selected',
    hasSelection: true,
    context: 'within current filter',
    selectAll: {
      label: 'Select all visible results',
      checked: false,
      indeterminate: true,
      onChange: fn(),
    },
    actions: [
      {
        label: 'Complete 3',
        accessibleLabel: 'Complete 3 selected results',
        icon: 'check',
        variant: 'primary',
        onClick: fn(),
      },
    ],
  },
  argTypes: {
    label: { control: 'text' },
    count: { control: 'text' },
    hasSelection: { control: 'boolean' },
    context: { control: 'text' },
    selectAll: { control: 'object' },
    actions: { control: 'object' },
    className: { control: false },
  },
  // The queue column in the source is about 330 to 400px wide.
  render: (args) => (
    <div style={{ maxWidth: 400 }}>
      <BulkActionBar {...args} />
    </div>
  ),
} satisfies Meta<typeof BulkActionBar>

export default meta

type Story = StoryObj<typeof meta>

/** The approved composition: some visible results selected, one primary action. */
export const Default: Story = {}

/** Nothing selected: a plain prompt and no actions, as in the source. */
export const NothingSelected: Story = {
  args: {
    count: 'Select visible results',
    hasSelection: false,
    context: undefined,
    selectAll: { label: 'Select all visible results', checked: false, onChange: fn() },
    actions: [],
  },
}

/** Every visible result selected. */
export const AllSelected: Story = {
  args: {
    count: '12 results selected',
    selectAll: { label: 'Select all visible results', checked: true, onChange: fn() },
    actions: [{ label: 'Complete 12', icon: 'check', variant: 'primary', onClick: fn() }],
  },
}

/** Secondary and quiet actions, for when the reader already shows the primary action. */
export const SeveralActions: Story = {
  args: {
    actions: [
      { label: 'Complete', icon: 'check', onClick: fn() },
      { label: 'Snooze', icon: 'clock', onClick: fn() },
      { label: 'Clear selection', variant: 'quiet', onClick: fn() },
    ],
  },
}

/** Disabled checkbox and actions cannot be focused or activated. */
export const Disabled: Story = {
  args: {
    selectAll: {
      label: 'Select all visible results',
      checked: false,
      indeterminate: true,
      disabled: true,
      onChange: fn(),
    },
    actions: [
      { label: 'Complete 3', icon: 'check', variant: 'primary', disabled: true, onClick: fn() },
      { label: 'Clear selection', variant: 'quiet', disabled: true, onClick: fn() },
    ],
  },
}

/** Without a select-all checkbox, when the caller places it elsewhere. */
export const WithoutCheckbox: Story = { args: { selectAll: undefined } }

/** The source's Dutch copy. */
export const Dutch: Story = {
  args: {
    label: 'Bulkacties',
    count: '3 resultaten geselecteerd',
    context: 'binnen huidige filter',
    selectAll: {
      label: 'Selecteer alle zichtbare resultaten',
      checked: false,
      indeterminate: true,
      onChange: fn(),
    },
    actions: [{ label: '3 afhandelen', icon: 'check', variant: 'primary', onClick: fn() }],
  },
}

/** Long Dutch count, scope and actions wrap instead of widening the column. */
export const LongCopy: Story = {
  args: {
    label: 'Bulkacties',
    count: '1.284 resultaten geselecteerd',
    context:
      'binnen Architectenbureau Atelier Linden & Partners · Gemeentelijke Belastingsamenwerking Rivierenland',
    actions: [
      { label: 'Alle geselecteerde resultaten lokaal afhandelen', icon: 'check', onClick: fn() },
      { label: 'Selectie wissen', variant: 'quiet', onClick: fn() },
    ],
  },
}

/** A 280px column, narrower than any phone: the actions move under the text. */
export const NarrowWidth: Story = {
  args: { ...LongCopy.args },
  render: (args) => (
    <div style={{ width: 280 }}>
      <BulkActionBar {...args} />
    </div>
  ),
}
