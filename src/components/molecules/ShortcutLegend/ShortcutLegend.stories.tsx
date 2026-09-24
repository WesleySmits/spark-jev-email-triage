import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState, type ComponentProps } from 'react'
import { expect, userEvent, within } from 'storybook/test'
import { ShortcutLegend } from './ShortcutLegend'

const keysOn = 'K, J, E and / act on their own.'
const keysOff = 'Letters and / do nothing here. Tab, Enter and Escape still work.'

const noKeys: ComponentProps<typeof ShortcutLegend>['shortcuts'] = []

/** The legend with a working setting, as a page that owns the choice gives it. */
function WithSetting(args: ComponentProps<typeof ShortcutLegend>) {
  const [on, setOn] = useState(true)
  return (
    <ShortcutLegend
      {...args}
      shortcuts={on ? args.shortcuts : noKeys}
      setting={{
        label: 'Single-key shortcuts',
        on,
        note: on ? keysOn : keysOff,
        onChange: setOn,
      }}
    />
  )
}

const meta = {
  title: 'Molecules/Shortcut legend',
  component: ShortcutLegend,
  args: {
    shortcuts: [
      { label: 'Next / previous', keys: ['K', 'J'] },
      { label: 'Complete', keys: ['E'] },
    ],
  },
  argTypes: {
    shortcuts: { control: 'object' },
    setting: { control: 'object' },
    className: { table: { disable: true } },
  },
  // The source sidebar is 184px wide with an --s3 footer padding.
  decorators: [
    (Story) => (
      <div style={{ maxWidth: 160 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ShortcutLegend>

export default meta

type Story = StoryObj<typeof meta>

/** The legend only shows the keys. Pressing them here does nothing. */
export const Default: Story = {}

/** In place: the sidebar footer owns the --surface fill, top border and padding. */
export const InSidebarFooter: Story = {
  decorators: [
    (Story) => (
      <div
        style={{
          width: 184,
          boxSizing: 'border-box',
          padding: 'var(--s3)',
          borderTop: '1px solid var(--line)',
          background: 'var(--surface)',
        }}
      >
        <Story />
      </div>
    ),
  ],
}

export const WithSearch: Story = {
  args: {
    shortcuts: [
      { label: 'Search', keys: ['/'] },
      { label: 'Next / previous', keys: ['K', 'J'] },
      { label: 'Complete', keys: ['E'] },
    ],
  },
}

export const Dutch: Story = {
  args: {
    shortcuts: [
      { label: 'Volgende / vorige', keys: ['K', 'J'] },
      { label: 'Afhandelen', keys: ['E'] },
    ],
  },
}

// A label that doesn't fit keeps its keys together on the next line.
export const Narrow: Story = {
  args: {
    shortcuts: [
      { label: 'Volgende / vorige bericht in de wachtrij', keys: ['K', 'J'] },
      { label: 'Afhandelen', keys: ['E'] },
    ],
  },
  decorators: [
    (Story) => (
      <div style={{ width: 120 }}>
        <Story />
      </div>
    ),
  ],
}

/**
 * With the setting: the box says whether the single-key shortcuts are on, and
 * its note says what that means. Turning it off leaves no key listed, because
 * the page then acts on none. The caller stores the choice.
 */
export const WithShortcutSetting: Story = {
  render: (args) => <WithSetting {...args} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const box = canvas.getByRole('checkbox', { name: 'Single-key shortcuts' })
    await expect(box).toBeChecked()
    await expect(canvas.getByText(keysOn)).toBeVisible()
    await expect(box).toHaveAccessibleDescription(keysOn)
    await expect(canvas.getByText('Next / previous')).toBeVisible()

    // Off: the rows go, the note says what still works, and the box is reachable.
    await userEvent.click(box)
    await expect(box).not.toBeChecked()
    await expect(canvas.getByText(keysOff)).toBeVisible()
    await expect(box).toHaveAccessibleDescription(keysOff)
    await expect(canvas.queryByText('Next / previous')).toBeNull()

    // The space bar works the box itself, as it does in any checkbox.
    box.focus()
    await userEvent.keyboard(' ')
    await expect(box).toBeChecked()
    await expect(canvas.getByText('Next / previous')).toBeVisible()
  },
}

/** Turned off: the setting is all the help area has left to show. */
export const ShortcutsTurnedOff: Story = {
  args: {
    shortcuts: [],
    setting: { label: 'Single-key shortcuts', on: false, note: keysOff, onChange: () => undefined },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('checkbox', { name: 'Single-key shortcuts' })).not.toBeChecked()
    await expect(canvas.getByText(keysOff)).toBeVisible()
    await expect(canvas.queryByRole('definition')).toBeNull()
  },
}

/** In the sidebar footer, where the rail shows it below the filters. */
export const SettingInSidebarFooter: Story = {
  ...InSidebarFooter,
  render: (args) => <WithSetting {...args} />,
}
