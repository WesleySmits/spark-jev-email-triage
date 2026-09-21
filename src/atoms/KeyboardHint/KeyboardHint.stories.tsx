import type { Meta, StoryObj } from '@storybook/react-vite'
import { KeyboardHint } from './KeyboardHint'

const meta = {
  title: 'Atoms/Keyboard hint',
  component: KeyboardHint,
  args: { children: 'E' },
  argTypes: { children: { control: 'text' } },
} satisfies Meta<typeof KeyboardHint>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const Shortcuts: Story = {
  argTypes: { children: { table: { disable: true } } },
  render: () => (
    <dl
      style={{
        display: 'grid',
        gridTemplateColumns: 'max-content max-content',
        gap: 'var(--s2) var(--s4)',
        margin: 0,
        color: 'var(--ink)',
        font: 'var(--text-ui)',
      }}
    >
      <dt>Search</dt>
      <dd style={{ margin: 0 }}>
        <KeyboardHint>/</KeyboardHint>
      </dd>
      <dt>Next / previous</dt>
      <dd style={{ display: 'flex', gap: 'var(--s1)', margin: 0 }}>
        <KeyboardHint>J</KeyboardHint>
        <KeyboardHint>K</KeyboardHint>
      </dd>
      <dt>Complete</dt>
      <dd style={{ margin: 0 }}>
        <KeyboardHint>E</KeyboardHint>
      </dd>
    </dl>
  ),
}
