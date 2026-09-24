import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'
import { QueueHeader } from './QueueHeader'

const meta = {
  title: 'Molecules/Queue header',
  component: QueueHeader,
  args: {
    title: 'Needs review',
    headingLevel: 2,
    count: '3 results',
    context: 'All accounts · current filter',
  },
  argTypes: {
    title: { control: 'text' },
    headingLevel: { control: 'inline-radio', options: [1, 2, 3] },
    count: { control: 'text' },
    context: { control: 'text' },
    scope: { control: 'object' },
    titleId: { control: false },
    className: { control: false },
  },
  // The queue column in the source is about 330 to 400px wide.
  render: (args) => (
    <div style={{ maxWidth: 400 }}>
      <QueueHeader {...args} />
    </div>
  ),
} satisfies Meta<typeof QueueHeader>

export default meta

type Story = StoryObj<typeof meta>

/** The approved composition: title, count and scope, without an action. */
export const Default: Story = {}

/** With one secondary action and a decorative icon. Clicking it logs `onClick`. */
export const WithAction: Story = {
  args: { action: { label: 'Complete selected', icon: 'check', onClick: fn() } },
}

export const QuietAction: Story = {
  args: { action: { label: 'Select all', variant: 'quiet', onClick: fn() } },
}

/** Disabled actions cannot be focused or activated. */
export const DisabledAction: Story = {
  args: { action: { label: 'Refresh', disabled: true, onClick: fn() } },
}

/** Without a context line. */
export const TitleAndCount: Story = { args: { context: undefined } }

/**
 * A bounded reading: the count is of loaded rows, and the marked scope line
 * says what was left out, so nothing reads as a whole mailbox.
 */
export const BoundedScope: Story = {
  args: {
    title: 'Recent mail',
    count: '50 results',
    scope: {
      summary: 'Loaded: 50 recent messages from 5 of 7 readable mailboxes',
      detail:
        '2 readable mailboxes were not read at all, so even the newest mail in them is missing (at most 5 mailboxes). Older mail was left out of 5 loaded mailboxes (at most 10 recent Inbox messages each). Search and filters cover only loaded mail.',
      refreshed: { label: 'Last refreshed 09:42.', dateTime: '2026-09-24T07:42:00.000Z' },
      bounded: true,
    },
    action: { label: 'Refresh', onClick: fn() },
  },
}

/** A reading no bound cut. It still says only what it loaded. */
export const UnboundedScope: Story = {
  args: {
    ...BoundedScope.args,
    count: '7 results',
    scope: {
      summary: 'Loaded: 7 recent messages from 2 mailboxes',
      detail:
        'Every readable mailbox was loaded and none reached the 10 recent Inbox messages bound, so nothing was cut. Search and filters cover only loaded mail.',
      refreshed: { label: 'Last refreshed 09:42.', dateTime: '2026-09-24T07:42:00.000Z' },
      bounded: false,
    },
  },
}

/**
 * A reading that could not read one of its mailboxes. The failure is its own
 * line, marked apart from a bound, and announced: a refresh that lost a
 * mailbox changes what the list means without moving focus.
 */
export const UnreadMailbox: Story = {
  args: {
    ...BoundedScope.args,
    count: '4 results',
    scope: {
      summary: 'Loaded: 4 recent messages from 2 of 3 readable mailboxes',
      detail: 'Search and filters cover only loaded mail.',
      unread:
        '1 mailbox could not be read, so none of its mail is shown (atelier@mail.example). ' +
        'The rest of this reading was read without it. How much it holds is unknown. ' +
        'Refresh to try again.',
      refreshed: { label: 'Last refreshed 09:42.', dateTime: '2026-09-24T07:42:00.000Z' },
      bounded: false,
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const unread = canvas.getByRole('status')
    await expect(unread).toBeVisible()
    await expect(unread).toHaveTextContent('1 mailbox could not be read')
    // A failure is not a bound, so the line takes no bounded marking.
    await expect(canvasElement.querySelector('.queue-header__scope')).not.toHaveClass(
      'queue-header__scope--bounded',
    )
    // The only focus stop is the retry, so the keyboard reaches Refresh first.
    await userEvent.tab()
    await expect(canvas.getByRole('button', { name: 'Refresh' })).toHaveFocus()
    await expect(unread).not.toHaveFocus()
  },
}

/** Every mailbox failed: no mail at all, and no claim that they are empty. */
export const NoMailboxRead: Story = {
  args: {
    ...UnreadMailbox.args,
    count: '0 results',
    scope: {
      summary: 'Loaded: 0 recent messages from 0 of 3 readable mailboxes',
      detail: 'Search and filters cover only loaded mail.',
      unread:
        'No listed mailbox could be read, so no mail is shown (studio@mail.example, ' +
        'atelier@mail.example, personal@mail.example). How much they hold is unknown. ' +
        'Refresh to try again.',
      refreshed: { label: 'Last refreshed 09:42.', dateTime: '2026-09-24T07:42:00.000Z' },
      bounded: false,
    },
  },
}

/** The failure line at a phone-width column: it wraps instead of being cut. */
export const UnreadMailboxOnMobile: Story = {
  args: { ...UnreadMailbox.args },
  render: (args) => (
    <div style={{ width: 320 }}>
      <QueueHeader {...args} />
    </div>
  ),
}

/** The scope line at a phone-width column: it wraps instead of being cut. */
export const ScopeOnMobile: Story = {
  args: { ...BoundedScope.args },
  render: (args) => (
    <div style={{ width: 320 }}>
      <QueueHeader {...args} />
    </div>
  ),
}

/** The source's Dutch copy. */
export const Dutch: Story = {
  args: {
    title: 'Te beoordelen',
    count: '3 resultaten',
    context: 'Alle accounts · huidige filter',
    action: { label: 'Vernieuwen', onClick: fn() },
  },
}

/** Long Dutch title, count, context and action wrap instead of widening the column. */
export const LongCopy: Story = {
  args: {
    title: 'Overheidscorrespondentie die nog beoordeeld moet worden voor vrijdag',
    count: '1.284 resultaten binnen deze selectie',
    context:
      'Architectenbureau Atelier Linden & Partners · Gemeentelijke Belastingsamenwerking Rivierenland · huidige filter',
    action: { label: 'Alle zichtbare resultaten vernieuwen', onClick: fn() },
  },
}

/** A 280px column, narrower than any phone: the action moves under the text. */
export const NarrowWidth: Story = {
  args: { ...LongCopy.args },
  render: (args) => (
    <div style={{ width: 280 }}>
      <QueueHeader {...args} />
    </div>
  ),
}

/** In place above a list: the list is named by the heading through `titleId`. */
export const NamingAList: Story = {
  args: { titleId: 'queue-title', action: { label: 'Refresh', onClick: fn() } },
  render: (args) => (
    <section style={{ maxWidth: 400, background: 'var(--paper)' }}>
      <QueueHeader {...args} />
      <ul
        aria-labelledby="queue-title"
        style={{ margin: 0, padding: 'var(--s4)', color: 'var(--muted)', font: 'var(--text-ui)' }}
      >
        <li>Message rows go here.</li>
      </ul>
    </section>
  ),
}
