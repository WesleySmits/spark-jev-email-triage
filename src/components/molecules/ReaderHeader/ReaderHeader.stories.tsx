import type { Meta, StoryObj } from '@storybook/react-vite'
import { ReaderHeader } from './ReaderHeader'

const meta = {
  title: 'Molecules/Reader header',
  component: ReaderHeader,
  args: {
    subject: 'Can delivery move a week earlier?',
    headingLevel: 2,
    status: { tone: 'review', label: 'Needs review' },
    sender: {
      name: 'Marit Vos',
      initials: 'MV',
      address: 'marit.vos@example.com',
      account: { marker: 'studio', label: 'Studio Noord' },
      time: 'Today, 09:42',
      dateTime: '2026-09-21T09:42',
    },
  },
  argTypes: {
    subject: { control: 'text' },
    headingLevel: { control: 'inline-radio', options: [1, 2, 3, 4] },
    status: { control: 'object' },
    sender: { control: 'object' },
    subjectId: { control: false },
    className: { control: false },
  },
  // The reader column in the source: flexible, wider than the 730px measure.
  render: (args) => (
    <div style={{ maxWidth: 820 }}>
      <ReaderHeader {...args} />
    </div>
  ),
} satisfies Meta<typeof ReaderHeader>

export default meta

type Story = StoryObj<typeof meta>

/** The approved composition: subject, review badge and the sender row. */
export const Default: Story = {}

export const Statuses: Story = {
  argTypes: { status: { table: { disable: true } } },
  render: (args) => (
    <div style={{ display: 'grid', gap: 'var(--s4)', maxWidth: 820 }}>
      <ReaderHeader {...args} />
      <ReaderHeader
        {...args}
        subject="Invoice correction AL-2048"
        status={{ tone: 'neutral', label: 'Invoice' }}
      />
      <ReaderHeader
        {...args}
        subject="Material choice approved"
        status={{ tone: 'done', label: 'Done' }}
      />
    </div>
  ),
}

/** Without a status, address or machine-readable time. */
export const MissingOptionalData: Story = {
  args: {
    status: undefined,
    sender: {
      name: 'Mila de Jong',
      initials: 'MJ',
      account: { marker: 'personal', label: 'Personal' },
      time: 'Monday, 19:14',
    },
  },
}

/** The source's Dutch copy. */
export const Dutch: Story = {
  args: {
    subject: 'Kan de oplevering één week naar voren?',
    status: { tone: 'review', label: 'Controle nodig' },
    sender: {
      name: 'Marit Vos',
      initials: 'MV',
      address: 'marit.vos@voorbeeld.nl',
      account: { marker: 'studio', label: 'Studio Noord' },
      toLabel: 'naar',
      time: 'Vandaag, 09:42',
      dateTime: '2026-09-21T09:42',
    },
  },
}

/** Long Dutch subject, status and sender wrap instead of widening the reader. */
export const LongContent: Story = {
  args: {
    subject:
      'Aanvullende gegevens nodig voor de omgevingsvergunningaanvraag Rivierenland-Noordoostpolder, dossiernummer OLO-2026-0048213',
    status: { tone: 'review', label: 'Controle nodig vóór vrijdag' },
    sender: {
      name: 'Gemeentelijke Belastingsamenwerking Rivierenland-Noordoostpolder, afdeling Vergunningen',
      initials: 'GB',
      address: 'noreply-vergunningen.omgevingsloket@belastingsamenwerking-rivierenland.nl',
      account: { marker: 'atelier', label: 'Architectenbureau Atelier Linden & Partners' },
      toLabel: 'naar',
      time: 'Gisteren, 16:26',
    },
  },
}

/** A 280px column, narrower than any phone: the badge moves under the subject. */
export const NarrowWidth: Story = {
  args: { ...LongContent.args },
  render: (args) => (
    <div style={{ width: 280 }}>
      <ReaderHeader {...args} />
    </div>
  ),
}

/** In place at the top of a reader, which is named by the heading through `subjectId`. */
export const InReader: Story = {
  args: { subjectId: 'reader-subject' },
  render: (args) => (
    <article aria-labelledby="reader-subject" style={{ maxWidth: 820, background: 'var(--paper)' }}>
      <ReaderHeader {...args} />
      <p
        style={{
          maxWidth: 'var(--measure-message)',
          margin: 0,
          padding: 'var(--s6)',
          font: 'var(--text-message)',
          color: 'var(--ink-soft)',
        }}
      >
        The message body goes here.
      </p>
    </article>
  ),
}
