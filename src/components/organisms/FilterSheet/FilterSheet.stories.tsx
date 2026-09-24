import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState, type ComponentProps } from 'react'
import { expect, fn, userEvent, within } from 'storybook/test'
import { Button } from '../../atoms/Button/Button'
import { Sidebar } from '../Sidebar/Sidebar'
import SidebarStories from '../Sidebar/Sidebar.stories'
import { FilterSheet } from './FilterSheet'

type Props = ComponentProps<typeof FilterSheet>

// The sheet holds the same rail the wide layout shows, so its story shows the
// Sidebar story's own filters. Selecting only logs.
const rail = <Sidebar {...SidebarStories.args} onSelect={fn()} />

const meta = {
  title: 'Organisms/Filter sheet',
  component: FilterSheet,
  args: { label: 'Filters', open: true, children: rail, onClose: fn() },
  argTypes: {
    label: { control: 'text' },
    open: { control: 'boolean' },
    closeLabel: { control: 'text' },
    children: { control: false },
    className: { control: false },
  },
  parameters: { layout: 'fullscreen' },
  // Stands in for the caller: a page with something behind the sheet, and a
  // button that opens it again once it has been closed.
  render: function Render({ open, onClose, ...args }: Props) {
    const [shown, setShown] = useState(open)
    return (
      <div style={{ padding: 'var(--s4)', display: 'grid', gap: 'var(--s4)' }}>
        <Button
          variant="secondary"
          aria-haspopup="dialog"
          aria-expanded={shown}
          onClick={() => {
            setShown(true)
          }}
        >
          Filters
        </Button>
        <p style={{ margin: 0 }}>The page behind the sheet. It is inert while the sheet is open.</p>
        <FilterSheet
          {...args}
          open={shown}
          onClose={() => {
            onClose()
            setShown(false)
          }}
        />
      </div>
    )
  },
} satisfies Meta<typeof FilterSheet>

export default meta

type Story = StoryObj<typeof meta>

/**
 * The open sheet at 320px: the filters the rail would hold, over a page that
 * is inert while it is open.
 *
 * ```tsx
 * <FilterSheet label="Filters" open={open} onClose={() => { setOpen(false) }}>
 *   <Sidebar label="Filters" groups={groups} onSelect={select} />
 * </FilterSheet>
 * ```
 */
export const Open: Story = {
  globals: { viewport: { value: 'mobile1', isRotated: false } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const sheet = canvas.getByRole('dialog', { name: 'Filters' })
    await expect(sheet).toBeVisible()
    // Opening moved focus into the sheet, and the whole rail is reachable.
    await expect(sheet).toContainElement(document.activeElement as HTMLElement)
    await expect(within(sheet).getByRole('button', { name: /^Needs review/ })).toBeVisible()
    // Nothing behind it takes focus: Tab stays inside.
    await userEvent.tab()
    await expect(sheet).toContainElement(document.activeElement as HTMLElement)
  },
}

/** Closed: it leaves the layout, the tab order and the accessibility tree. */
export const Closed: Story = {
  args: { open: false },
  globals: { viewport: { value: 'mobile1', isRotated: false } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.queryByRole('dialog')).not.toBeInTheDocument()
    await expect(canvas.queryByRole('complementary', { name: 'Filters' })).not.toBeInTheDocument()
    // It opens from the caller's button, and Escape closes it again.
    await userEvent.click(canvas.getByRole('button', { name: 'Filters' }))
    await expect(canvas.getByRole('dialog', { name: 'Filters' })).toBeVisible()
    await userEvent.keyboard('{Escape}')
    await expect(canvas.queryByRole('dialog')).not.toBeInTheDocument()
    await expect(canvas.getByRole('button', { name: 'Filters' })).toHaveFocus()
  },
}

/** The close button closes it and hands focus back to whatever opened it. */
export const ClosesFromItsButton: Story = {
  args: { open: false },
  globals: { viewport: { value: 'phone390', isRotated: false } },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const open = canvas.getByRole('button', { name: 'Filters' })
    await userEvent.click(open)
    const sheet = canvas.getByRole('dialog', { name: 'Filters' })
    await userEvent.click(within(sheet).getByRole('button', { name: 'Close filters' }))
    await expect(args.onClose).toHaveBeenCalled()
    await expect(canvas.queryByRole('dialog')).not.toBeInTheDocument()
    await expect(open).toHaveFocus()
  },
}

/** A Dutch name, so the dialog, its heading and its close button all say it. */
export const DutchLabel: Story = {
  args: { label: 'Filters en mailboxen', closeLabel: 'Filters sluiten' },
  globals: { viewport: { value: 'mobile1', isRotated: false } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const sheet = canvas.getByRole('dialog', { name: 'Filters en mailboxen' })
    await expect(within(sheet).getByText('Filters en mailboxen')).toBeVisible()
    await expect(within(sheet).getByRole('button', { name: 'Filters sluiten' })).toBeVisible()
  },
}
