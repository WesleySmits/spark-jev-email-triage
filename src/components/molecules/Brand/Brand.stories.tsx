import type { Meta, StoryObj } from '@storybook/react-vite'
import { Brand } from './Brand'

const meta = {
  title: 'Molecules/Brand',
  component: Brand,
  args: { name: 'Spark Triage', size: 'md', wordmark: true },
  argTypes: {
    name: { control: 'text' },
    size: { control: 'inline-radio', options: ['md', 'sm'] },
    wordmark: { control: 'boolean' },
    className: { table: { disable: true } },
  },
} satisfies Meta<typeof Brand>

export default meta

type Story = StoryObj<typeof meta>

/** The desktop top bar brand: a 25px mark and the wordmark. */
export const Default: Story = {}

/** The 24px mark from the source's mobile top bar. */
export const Small: Story = { args: { size: 'sm' } }

/** Mark only. The glyph becomes an image named "Spark Triage". */
export const MarkOnly: Story = { args: { wordmark: false } }

/** On the source's top bar surface and 52px height. The Brand is not a header. */
export const InTopBar: Story = {
  render: (args) => (
    <div
      style={{
        height: 52,
        display: 'flex',
        alignItems: 'center',
        padding: '0 var(--s4)',
        borderBottom: '1px solid var(--line)',
        background: 'var(--surface)',
      }}
    >
      <Brand {...args} />
    </div>
  ),
}

/** In a 120px box a longer name wraps under itself; the mark keeps its size. */
export const Narrow: Story = {
  args: { name: 'Spark Triage Workbench' },
  decorators: [
    (Story) => (
      <div style={{ width: 120 }}>
        <Story />
      </div>
    ),
  ],
}
