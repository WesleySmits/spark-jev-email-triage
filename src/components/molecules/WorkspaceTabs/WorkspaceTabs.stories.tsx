import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, fn, userEvent, within } from 'storybook/test'
import { WorkspaceTabs } from './WorkspaceTabs'

const tabs = [
  {
    id: 'inbox',
    label: 'Spark Inbox',
    count: '10 loaded',
    countLabel: 'messages loaded from Spark',
  },
  { id: 'work', label: 'Open work', count: '3', countLabel: 'open items saved in this app' },
] as const

const meta = {
  title: 'Molecules/Workspace tabs',
  component: WorkspaceTabs,
  args: { label: 'Workbench lists', tabs, current: 'inbox', onSelect: fn() },
  argTypes: { className: { control: false } },
  // The queue column is 280 to 400px wide, on --paper.
  render: function Render(args) {
    const [current, setCurrent] = useState(args.current)
    return (
      <div style={{ maxWidth: 400, background: 'var(--paper)' }}>
        <WorkspaceTabs
          {...args}
          current={current}
          onSelect={(id) => {
            setCurrent(id)
            args.onSelect(id)
          }}
        />
      </div>
    )
  },
} satisfies Meta<typeof WorkspaceTabs>

export default meta

type Story = StoryObj<typeof meta>

/**
 * The Inbox shows. Each tab names what its count is of, so the Spark count
 * and the count of work saved here are never read as one figure.
 */
export const InboxCurrent: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const nav = canvas.getByRole('navigation', { name: 'Workbench lists' })
    await expect(nav).toBeVisible()
    await expect(
      canvas.getByRole('button', { name: 'Spark Inbox: 10 loaded messages loaded from Spark' }),
    ).toHaveAttribute('aria-current', 'page')
    await expect(
      canvas.getByRole('button', { name: 'Open work: 3 open items saved in this app' }),
    ).not.toHaveAttribute('aria-current')
  },
}

/** Keyboard only: Tab reaches the Open work tab and Enter shows it. */
export const KeyboardSwitch: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.tab()
    await userEvent.tab()
    const work = canvas.getByRole('button', { name: /^Open work/ })
    await expect(work).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    await expect(work).toHaveAttribute('aria-current', 'page')
    await expect(args.onSelect).toHaveBeenCalledWith('work')
  },
}

/** A phone: both tabs fit and wrap rather than overflow. */
export const Phone: Story = {
  globals: { viewport: { value: 'phone390' } },
  args: { current: 'work' },
  play: async ({ canvasElement }) => {
    const nav = canvasElement.querySelector('.workspace-tabs')
    await expect(nav?.scrollWidth).toBeLessThanOrEqual(nav?.clientWidth ?? 0)
  },
}
