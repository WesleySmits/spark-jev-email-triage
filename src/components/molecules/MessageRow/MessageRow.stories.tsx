import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState, type ComponentProps } from 'react'
import { fn } from 'storybook/test'
import { MessageRow } from './MessageRow'

const meta = {
  title: 'Molecules/Message row',
  component: MessageRow,
  args: {
    sender: 'Marit Vos',
    time: '09:42',
    dateTime: '2026-09-21T09:42',
    subject: 'Can delivery move a week earlier?',
    snippet: 'After our meeting I took another look at the planning internally…',
    account: { marker: 'studio', label: 'Studio Noord' },
    status: { label: 'Needs review', tone: 'review' },
    category: 'Customer question',
    unread: false,
    selected: false,
    onActivate: fn(),
  },
  argTypes: {
    sender: { control: 'text' },
    time: { control: 'text' },
    subject: { control: 'text' },
    snippet: { control: 'text' },
    category: { control: 'text' },
    unread: { control: 'boolean' },
    selected: { control: 'boolean' },
  },
  // The queue column in the source is about 330 to 400px wide.
  render: (args) => (
    <ul style={{ maxWidth: 400, margin: 0, padding: 0, listStyle: 'none' }}>
      <li>
        <MessageRow {...args} />
      </li>
    </ul>
  ),
} satisfies Meta<typeof MessageRow>

export default meta

type Story = StoryObj<typeof meta>

/** A read row without bulk selection. Clicking it logs `onActivate`. */
export const Default: Story = {}

export const Unread: Story = { args: { unread: true } }

/** A row with a reason line: who decided its labels, in words that wrap. */
export const WithReason: Story = {
  args: {
    status: { label: 'Triage from earlier', tone: 'neutral' },
    category: 'Personal',
    reason:
      "Personal, decided by a person; priority Low, the model's. Model advice: Notification, Low.",
  },
}

/** The row open in the reader: accent rule, soft fill, `aria-current="true"`. */
export const Selected: Story = { args: { unread: true, selected: true } }

/** With a bulk-selection checkbox, checked. The caller owns `checked`. */
export const Checked: Story = {
  args: {
    selection: {
      label: 'Select Can delivery move a week earlier?',
      checked: true,
      onChange: fn(),
    },
  },
}

type Row = Omit<ComponentProps<typeof MessageRow>, 'onActivate' | 'selected' | 'selection'> & {
  id: string
}

const rows: Row[] = [
  {
    id: 'm1',
    sender: 'Marit Vos',
    time: '09:42',
    subject: 'Kan de oplevering één week naar voren?',
    snippet: 'Na ons overleg heb ik intern nog even naar de planning gekeken…',
    account: { marker: 'studio', label: 'Studio Noord' },
    status: { label: 'Controle nodig', tone: 'review' },
    unread: true,
  },
  {
    id: 'm2',
    sender: 'Daan Kramer',
    time: '08:17',
    subject: 'Correctie op factuur AL-2048',
    snippet: 'De bedrijfsnaam op de factuur mist nog de toevoeging B.V.…',
    account: { marker: 'atelier', label: 'Atelier Linden' },
    status: { label: 'Actie nodig', tone: 'neutral' },
    category: 'Factuur',
    unread: true,
  },
  {
    id: 'm5',
    sender: 'Mila de Jong',
    time: 'Ma',
    subject: 'Etentje vrijdag verzetten?',
    snippet: 'Zou zaterdagavond voor jou ook passen? Dan kan Koen…',
    account: { marker: 'personal', label: 'Persoonlijk' },
    status: { label: 'Te beoordelen', tone: 'review' },
    category: 'Persoonlijk',
  },
  {
    id: 'm6',
    sender: 'Bureau Kade',
    time: 'Ma',
    subject: 'Nieuwsbrief: werk dat ruimte maakt',
    snippet: 'Deze maand kijken we naar drie compacte werkplekken…',
    account: { marker: 'studio', label: 'Studio Noord' },
    status: { label: 'Afgehandeld', tone: 'done' },
    category: 'Nieuwsbrief',
  },
]

function Queue() {
  const [openId, setOpenId] = useState('m1')
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set(['m2']))
  return (
    <div style={{ display: 'grid', gap: 'var(--s3)', maxWidth: 400, font: 'var(--text-ui)' }}>
      <ul aria-label="Te beoordelen" style={{ margin: 0, padding: 0, listStyle: 'none' }}>
        {rows.map(({ id, ...row }) => (
          <li key={id}>
            <MessageRow
              {...row}
              selected={openId === id}
              onActivate={() => {
                setOpenId(id)
              }}
              selection={{
                label: `Selecteer ${row.subject}`,
                checked: checked.has(id),
                onChange: (isChecked) => {
                  setChecked((current) => {
                    const next = new Set(current)
                    if (isChecked) next.add(id)
                    else next.delete(id)
                    return next
                  })
                },
              }}
            />
          </li>
        ))}
      </ul>
      <p style={{ margin: 0, color: 'var(--muted)' }}>
        Geopend: {openId} · Geselecteerd: {[...checked].join(', ') || 'geen'}
      </p>
    </div>
  )
}

/**
 * Every status tone in one list, with local state for trying the row: a click
 * or Enter opens a row, the checkbox only selects it. The readout shows both.
 */
export const MultipleStatuses: Story = {
  render: () => <Queue />,
}

/** Long Dutch sender, subject, snippet, account and category end in an ellipsis or wrap. */
export const LongDutchContent: Story = {
  args: {
    sender: 'Gemeentelijke Belastingsamenwerking Rivierenland-Noordoostpolder',
    time: 'Gisteren',
    subject:
      'Herinnering: aanvullende gegevens nodig voor de aanvraag van de omgevingsvergunning Prinsengracht 1024',
    snippet:
      'Geachte heer, mevrouw, naar aanleiding van uw aanvraag ontvangen wij graag uiterlijk vrijdag de ontbrekende bouwtekeningen en de constructieberekening…',
    account: { marker: 'atelier', label: 'Architectenbureau Atelier Linden & Partners' },
    status: { label: 'Controle nodig', tone: 'review' },
    category: 'Overheidscorrespondentie',
    unread: true,
    selection: { label: 'Selecteer herinnering', checked: false, onChange: fn() },
  },
}

/** A 280px column, narrower than any phone, with bulk selection. */
export const NarrowWidth: Story = {
  args: {
    ...LongDutchContent.args,
    selected: true,
  },
  render: (args) => (
    <ul style={{ width: 280, margin: 0, padding: 0, listStyle: 'none' }}>
      <li>
        <MessageRow {...args} />
      </li>
    </ul>
  ),
}
