import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'
import { DisconnectedState } from './DisconnectedState'

const meta = {
  title: 'Molecules/Disconnected state',
  component: DisconnectedState,
  args: {
    title: 'Spark is unavailable',
    children: 'Your local review is still available. Nothing is sent to Spark until it is back.',
    lastKnown: 'Showing local data from 10:14. Spark may have changed since.',
    action: { label: 'Try again', onClick: fn() },
    headingLevel: 2,
    announce: true,
  },
  argTypes: {
    title: { control: 'text' },
    children: { control: 'text' },
    lastKnown: { control: 'text' },
    headingLevel: { control: 'inline-radio', options: [2, 3] },
    announce: { control: 'boolean' },
  },
  decorators: [
    (Story) => (
      <div style={{ maxWidth: 640 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof DisconnectedState>

export default meta

type Story = StoryObj<typeof meta>

/** The provider cannot be reached; local work goes on and the caller offers a retry. */
export const ProviderUnavailable: Story = {}

/** Local data is shown but may be out of date; the context says since when. */
export const StaleLocalData: Story = {
  args: {
    title: 'Could not refresh the queue',
    children: 'The list below is what this app last read from Spark. Refresh to check again.',
    lastKnown: 'Last read 09:52 · 3 messages · Spark may have changed since.',
    action: { label: 'Refresh', onClick: fn() },
  },
}

/** Nothing to retry here: no action and no footer, only the failure and next step. */
export const NoAction: Story = {
  args: {
    title: 'Spark access was revoked',
    children: 'Connect Spark again in Settings to read new mail. Local reviews are kept.',
    lastKnown: undefined,
    action: undefined,
  },
}

/** Dutch copy is longer; everything wraps and nothing truncates. */
export const LongDutchCopy: Story = {
  args: {
    title: 'Spark is niet bereikbaar voor studio@voorbeeldonderneming-met-een-lange-naam.nl',
    children:
      'Je lokale beoordelingen blijven beschikbaar en worden niet naar Spark gestuurd. Controleer je internetverbinding of probeer het over een paar minuten opnieuw; de mailbox is ongewijzigd.',
    lastKnown:
      'Lokale gegevens van 10:14 · 12 berichten in Te beoordelen · Spark kan sindsdien gewijzigd zijn.',
    action: { label: 'Opnieuw proberen', onClick: fn() },
  },
}

/** On a narrow screen the action takes its own full-width row with a 44px target. */
export const Narrow: Story = {
  ...LongDutchCopy,
  globals: { viewport: { value: 'mobile1', isRotated: false } },
}
