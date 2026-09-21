import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState, type ComponentProps } from 'react'
import { useArgs } from 'storybook/preview-api'
import { expect, fn, userEvent, within } from 'storybook/test'
import { TopBar } from './TopBar'

type Props = ComponentProps<typeof TopBar>

const meta = {
  title: 'Organisms/Top bar',
  component: TopBar,
  args: {
    productName: 'Spark Triage',
    searchLabel: 'Search current results',
    searchPlaceholder: 'Search current results',
    searchValue: '',
    searchShortcut: true,
    syncStatus: 'connected',
    syncLabel: 'Updated 2 min ago',
    profileLabel: 'Profile Wesley Smits',
    profileInitials: 'WS',
    onSearchChange: fn(),
    onSearchSubmit: fn(),
    onSyncClick: fn(),
  },
  argTypes: {
    productName: { control: 'text' },
    searchLabel: { control: 'text' },
    searchPlaceholder: { control: 'text' },
    searchValue: { control: 'text' },
    searchShortcut: { control: 'boolean' },
    syncStatus: { control: 'inline-radio', options: ['connected', 'disconnected'] },
    syncLabel: { control: 'text' },
    profileLabel: { control: 'text' },
    profileInitials: { control: 'text' },
    searchId: { table: { disable: true } },
    className: { table: { disable: true } },
  },
  // Stands in for the caller: typing updates the searchValue arg, so the
  // control follows along. Submit and sync only log their callbacks.
  render: function Render(args) {
    const [, updateArgs] = useArgs<Props>()
    return (
      <TopBar
        {...args}
        onSearchChange={(value) => {
          args.onSearchChange(value)
          updateArgs({ searchValue: value })
        }}
      />
    )
  },
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof TopBar>

export default meta

type Story = StoryObj<typeof meta>

/**
 * The approved desktop bar. Tab moves through search, sync status and nothing
 * else: the brand and avatar are not controls. Enter in the field logs
 * `onSearchSubmit` with the query.
 *
 * ```tsx
 * const [query, setQuery] = useState('')
 *
 * <TopBar
 *   searchLabel="Zoek in huidige resultaten"
 *   searchPlaceholder="Zoek in huidige resultaten"
 *   searchValue={query}
 *   onSearchChange={setQuery}
 *   onSearchSubmit={runSearch}
 *   syncStatus="connected"
 *   syncLabel="Bijgewerkt 2 min geleden"
 *   onSyncClick={showSyncDetails}
 *   profileLabel="Profiel Wesley Smits"
 *   profileInitials="WS"
 * />
 * ```
 */
export const Default: Story = {}

/** The danger dot and text, with when it last synced. */
export const Disconnected: Story = {
  args: { syncStatus: 'disconnected', syncLabel: 'Disconnected · last sync 10:14' },
}

/** Dutch copy with long words. The brand and sync text wrap; nothing scrolls sideways. */
export const LongDutchCopy: Story = {
  args: {
    productName: 'Spark Triage Werkbank',
    searchLabel: 'Zoek in huidige resultaten',
    searchPlaceholder: 'Zoek in huidige resultaten en gearchiveerde correspondentie',
    searchValue: 'leveranciersovereenkomstwijzigingsvoorstellen',
    syncStatus: 'disconnected',
    syncLabel: 'Verbinding verbroken · laatste synchronisatie vandaag om 10:14',
    profileLabel: 'Profiel Wesley Smits',
  },
}

/**
 * A 320px phone, also what 400% zoom gives on a 1280px screen. The search
 * takes its own row, and search and sync are 44px tall.
 */
export const Narrow: Story = {
  args: { ...LongDutchCopy.args },
  globals: { viewport: { value: 'mobile1', isRotated: false } },
}

// The caller owns the sync status. This flips it on click, like the source's
// offline preview, and shows the last submitted query. Nothing is synced or searched.
function CallerStory(args: Props) {
  const [query, setQuery] = useState('invoice')
  const [submitted, setSubmitted] = useState<string | null>(null)
  const [offline, setOffline] = useState(false)
  return (
    <>
      <TopBar
        {...args}
        searchValue={query}
        onSearchChange={setQuery}
        onSearchSubmit={(value) => {
          args.onSearchSubmit(value)
          setSubmitted(value)
        }}
        syncStatus={offline ? 'disconnected' : 'connected'}
        syncLabel={offline ? 'Disconnected · last sync 10:14' : 'Updated 2 min ago'}
        onSyncClick={() => {
          args.onSyncClick()
          setOffline(!offline)
        }}
      />
      <output style={{ display: 'block', padding: 'var(--s4)', font: 'var(--text-meta)' }}>
        Submitted: {submitted === null ? 'nothing yet' : JSON.stringify(submitted)}
      </output>
    </>
  )
}

/** Type and press Enter to submit; click the sync status to flip it. */
export const CallerControlled: Story = {
  argTypes: {
    searchValue: { table: { disable: true } },
    syncStatus: { table: { disable: true } },
    syncLabel: { table: { disable: true } },
  },
  render: (args) => <CallerStory {...args} />,
}

/**
 * Focuses the search with a query in it, so the `/` hint steps aside: while
 * focused, `/` types. A scripted click shows no focus ring; press Tab to
 * move on and see it on the sync status. Enter logs `onSearchSubmit`.
 */
export const SearchFocused: Story = {
  args: { searchValue: 'invoice' },
  play: async ({ canvasElement }) => {
    const search = within(canvasElement).getByRole('searchbox', { name: 'Search current results' })
    await userEvent.click(search)
    await expect(search).toHaveFocus()
  },
}
