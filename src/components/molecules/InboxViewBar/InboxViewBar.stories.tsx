import { useRef, useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import { inboxCoverage, viewCoverage } from '../../../app/inbox-coverage'
import { useInboxReadFocus, type InboxReadFocus } from '../../../app/inbox-read-focus'
import type { InboxListRequest, InboxScope, InboxView } from '../../../app/live-inbox'
import '../../../styles/app.css'
import { InboxZeroStatusBar } from '../InboxZeroStatusBar/InboxZeroStatusBar'
import { InboxViewBar } from './InboxViewBar'

const scope = (view: InboxView, bounded = true): InboxScope => ({
  view,
  pages: bounded ? 1 : 2,
  cursor: 'fictional-cursor',
  mailboxes: [
    { id: 'studio@mail.example', label: 'Studio mailbox', loaded: bounded ? 10 : 12, bounded },
  ],
  failed: [],
  incomplete: [],
  readable: 1,
  mailboxLimit: 10,
  messageLimit: 10,
  loaded: bounded ? 10 : 12,
  bounded,
  readAt: '09:44',
  refreshedAt: '2026-09-24T09:44:00.000Z',
})

const complete = (view: InboxView) =>
  viewCoverage({
    ...scope(view, false),
    loaded: 0,
    mailboxes: [{ id: 'studio@mail.example', label: 'Studio mailbox', loaded: 0, bounded: false }],
    startedAt: '2026-09-24T09:42:00.000Z',
  })

const coverage = inboxCoverage(inboxCoverage(undefined, complete('unread')), complete('other'))

function FocusAndStatusProof() {
  const [state, setState] = useState({ view: 'unread' as InboxView, loading: false, bounded: true })
  const root = useRef<HTMLDivElement>(null)
  const rememberFocus = useInboxReadFocus(root, state.loading)
  const change = async (request: InboxListRequest, focus: InboxReadFocus) => {
    rememberFocus(focus)
    setState((current) => ({ ...current, loading: true }))
    await new Promise((resolve) => window.setTimeout(resolve, 120))
    setState({ view: request.view, loading: false, bounded: request.cursor === undefined })
  }
  return (
    <div ref={root} style={{ width: 'min(100%, 400px)', padding: 16 }}>
      <div key={state.view}>
        <InboxViewBar
          scope={scope(state.view, state.bounded)}
          loading={state.loading}
          onChange={change}
        />
        <InboxZeroStatusBar coverage={coverage} refreshing={state.loading} />
      </div>
    </div>
  )
}

const meta = {
  title: 'Molecules/Inbox view bar',
  render: () => <FocusAndStatusProof />,
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

export const AccessibleLoadingAndFocus: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const other = canvas.getByRole('button', { name: 'Other Inbox' })
    other.focus()
    await userEvent.click(other)

    await expect(await canvas.findByText('Loading…')).toBeVisible()
    await expect(canvas.getByText('Inbox Zero verification pending')).toBeVisible()
    await expect(canvas.getByLabelText('Inbox Zero scan status').closest('[inert]')).toBeNull()
    await waitFor(async () => {
      const remounted = canvas.getByRole('button', { name: 'Other Inbox' })
      await expect(remounted).toHaveAttribute('aria-current', 'page')
      await expect(remounted).toBeEnabled()
      await expect(remounted).toHaveFocus()
    })

    await userEvent.click(canvas.getByRole('button', { name: 'Load older read messages' }))
    await waitFor(async () => {
      await expect(canvas.queryByRole('button', { name: 'Load older read messages' })).toBeNull()
      await expect(canvas.getByRole('button', { name: 'Other Inbox' })).toHaveFocus()
    })
  },
}
