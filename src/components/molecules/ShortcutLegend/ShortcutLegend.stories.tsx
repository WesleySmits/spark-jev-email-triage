import type { Meta, StoryObj } from '@storybook/react-vite'
import { ShortcutLegend } from './ShortcutLegend'

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
