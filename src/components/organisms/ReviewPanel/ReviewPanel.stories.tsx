import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState, type ComponentProps } from 'react'
import { fn } from 'storybook/test'
import { ReviewPanel, type ReviewField, type ReviewFieldOption } from './ReviewPanel'

type Props = ComponentProps<typeof ReviewPanel>

const categoryOptions: readonly ReviewFieldOption[] = [
  { value: 'customer-question', label: 'Customer question' },
  { value: 'invoice', label: 'Invoice' },
  { value: 'newsletter', label: 'Newsletter', note: "The model's advice" },
  { value: 'personal', label: 'Personal' },
]

const priorityOptions: readonly ReviewFieldOption[] = [
  { value: 'urgent', label: 'Urgent' },
  { value: 'high', label: 'High', note: "The model's advice" },
  { value: 'normal', label: 'Normal' },
  { value: 'low', label: 'Low' },
]

/**
 * The panel's fields as plain data. The fixture below supplies what a caller
 * owns: the choice each field holds, what its row then says, and the callbacks.
 */
const categoryField: ReviewField = {
  name: 'category',
  label: 'Category',
  advice: 'Newsletter',
  options: categoryOptions,
  chosen: null,
  onChoose: fn(),
  state: { label: 'Not reviewed', tone: 'none' },
  decidedBy: 'Nobody. The model decided this.',
  undoLabel: 'Undo',
}

const priorityField: ReviewField = {
  name: 'priority',
  label: 'Priority',
  advice: 'High',
  adviceNote: 'The model was not sure of this.',
  options: priorityOptions,
  chosen: null,
  onChoose: fn(),
  state: { label: 'Not reviewed', tone: 'none' },
  decidedBy: 'Nobody. The model decided this.',
  undoLabel: 'Undo',
}

const fields: readonly ReviewField[] = [categoryField, priorityField]

const meta = {
  title: 'Organisms/Review panel',
  component: ReviewPanel,
  args: {
    headingLevel: 2,
    title: 'Needs review',
    summary: 'Compare what the model advised with what you decide, field by field.',
    expanded: true,
    scoreLabel: 'Model score',
    score: 58,
    reasonTitle: 'Why review?',
    reason:
      'Triage policy asked for a person on the grounds below. Each is a rule over the scores, not the model’s own account of itself.',
    reasons: [
      "The model's score for this category stayed under the level triage accepts on its own.",
    ],
    keptNote: "The model's own advice is kept whatever you decide.",
    fieldsTitle: "The model's advice and your decision",
    fieldsHint:
      "Choose the value marked as the model's advice to confirm it, or another to change it. A field you leave alone stays unreviewed.",
    cells: { advice: 'Model advises', decision: 'Your decision', decidedBy: 'Decided by' },
    fields,
    outOfScope:
      'This panel decides the category and the priority only. Whether a reply is expected, and by when, is not confirmed here.',
    saveLabel: 'Save review',
    saveDisabled: true,
    onExpandedChange: fn(),
    onSave: fn(),
  },
  argTypes: {
    headingLevel: { control: 'inline-radio', options: [2, 3, 4] },
    score: { control: { type: 'range', min: 0, max: 100, step: 1 } },
    fields: { control: 'object' },
    reasons: { control: 'object' },
    result: { control: 'object' },
  },
  render: function Render(args) {
    return <ReviewFixture {...args} />
  },
  // The source reader gives the panel at most 820px.
  decorators: [
    (Story) => (
      <div style={{ maxWidth: 820 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ReviewPanel>

export default meta

type Story = StoryObj<typeof meta>

const counted = (fields: number) => `${String(fields)} ${fields === 1 ? 'field' : 'fields'}`

/** What one field's row says once a person has chosen one of its options. */
const chosenState = (option: ReviewFieldOption): ReviewField['state'] => ({
  label:
    option.note === undefined
      ? `Changing to ${option.label}. Not saved yet.`
      : `Confirming the model's advice, ${option.label}. Not saved yet.`,
  tone: 'pending',
})

type Choices = Readonly<Record<string, string>>

/** The fields as the fixture shows them: its own choice, state and callbacks. */
function shownFields(
  fields: readonly ReviewField[],
  choices: Choices,
  pick: (field: ReviewField, value: string) => void,
  forget: (field: ReviewField) => void,
): readonly ReviewField[] {
  return fields.map((field): ReviewField => {
    const chosen = choices[field.name]
    const option = field.options.find((one) => one.value === chosen)
    const onChoose = (value: string) => {
      pick(field, value)
    }
    if (chosen === undefined || option === undefined) return { ...field, onChoose }
    return {
      ...field,
      chosen,
      state: chosenState(option),
      onChoose,
      onUndo: () => {
        forget(field)
      },
    }
  })
}

/** What Save says it would record, unless the story says so itself. */
const labelFor = (args: Props, count: number) =>
  count === 0 ? args.saveLabel : `Save ${counted(count)}`

/** The copy beside Save, unless the story gives its own. */
const resultFor = (args: Props, count: number) =>
  args.result ??
  (count === 0
    ? { title: 'Nothing decided yet', detail: 'A field you leave alone stays unreviewed.' }
    : { title: `${counted(count)} ready to save`, detail: 'Your mailbox is unchanged.' })

/**
 * Stands in for the caller: it holds the choice each field has, counts what
 * Save would record, and announces a save through its own polite live region.
 * The panel itself announces nothing, and no choice is made for a field the
 * story has not touched.
 */
function ReviewFixture(args: Props) {
  const [choices, setChoices] = useState<Choices>({})
  const [announcement, setAnnouncement] = useState('')
  const count = args.fields.filter((field) => choices[field.name] !== undefined).length
  const fields = shownFields(
    args.fields,
    choices,
    (field, value) => {
      field.onChoose(value)
      setChoices((current) => ({ ...current, [field.name]: value }))
      setAnnouncement('')
    },
    (field) => {
      setChoices((current) =>
        Object.fromEntries(Object.entries(current).filter(([name]) => name !== field.name)),
      )
    },
  )
  return (
    <div style={{ display: 'grid', gap: 'var(--s3)' }}>
      <ReviewPanel
        {...args}
        fields={fields}
        saveDisabled={count === 0 ? args.saveDisabled : false}
        saveLabel={labelFor(args, count)}
        result={resultFor(args, count)}
        onSave={() => {
          args.onSave()
          setAnnouncement(
            `Review saved. ${counted(count)} recorded. Your mailbox is unchanged. Not completed yet.`,
          )
        }}
      />
      <p role="status" aria-live="polite" style={{ margin: 0, font: 'var(--text-meta)' }}>
        {announcement}
      </p>
    </div>
  )
}

/**
 * Nothing decided yet, so save is disabled and both rows say they are
 * unreviewed. Choose the value marked as the model's advice to confirm that
 * field, or another to change it; Save then says how many fields it records.
 *
 * ```tsx
 * <ReviewPanel
 *   title="Needs review"
 *   summary="Compare what the model advised with what you decide, field by field."
 *   expanded={expanded}
 *   onExpandedChange={setExpanded}
 *   scoreLabel="Model score"
 *   score={58}
 *   reasonTitle="Why review?"
 *   reason="Triage policy asked for a person on the grounds below."
 *   reasons={['The category score stayed under the level triage accepts.']}
 *   keptNote="The model's own advice is kept whatever you decide."
 *   fieldsTitle="The model's advice and your decision"
 *   cells={{ advice: 'Model advises', decision: 'Your decision', decidedBy: 'Decided by' }}
 *   fields={[category, priority]}
 *   saveLabel="Save 1 field"
 *   onSave={save}
 *   result={{ title: '1 field ready to save' }}
 * />
 * <p role="status" aria-live="polite">{announcement}</p>
 * ```
 */
export const Expanded: Story = {}

export const Collapsed: Story = { args: { expanded: false } }

/** One field a person decided earlier, and one nobody has: two different rows. */
export const OneFieldDecided: Story = {
  args: {
    fields: [
      {
        ...categoryField,
        chosen: 'customer-question',
        state: { label: 'Set to Customer question', tone: 'saved' },
        decidedBy: 'wesley, 25 Sep, 09:12',
      },
      priorityField,
    ],
    result: {
      title: 'Review saved',
      detail:
        'Category set to Customer question. The priority stays unreviewed, as the model had it. Your mailbox is unchanged.',
    },
  },
}

/** Both fields decided, one confirmed and one changed, and both stored. */
export const BothFieldsDecided: Story = {
  args: {
    fields: [
      {
        ...categoryField,
        chosen: 'newsletter',
        state: { label: 'Confirmed as Newsletter', tone: 'saved' },
        decidedBy: 'wesley, 25 Sep, 09:12',
      },
      {
        ...priorityField,
        chosen: 'normal',
        state: { label: 'Set to Normal', tone: 'saved' },
        decidedBy: 'wesley, 25 Sep, 09:31',
      },
    ],
    result: {
      title: 'Review saved',
      detail:
        "Category confirmed as Newsletter. Priority set to Normal. The model's own advice is kept. Your mailbox is unchanged.",
    },
  },
}

/** While a save is on its way: every option and undo is locked, and it says so. */
export const Saving: Story = {
  args: {
    fields: fields.map((field) => ({
      ...field,
      chosen: field.name === 'priority' ? 'normal' : null,
      disabled: true,
      ...(field.name === 'priority' && {
        state: { label: 'Changing to Normal. Not saved yet.', tone: 'pending' as const },
      }),
    })),
    saveDisabled: true,
    saveLabel: 'Save 1 field',
    result: { title: 'Saving review…', detail: 'Nothing is being sent to your mail.' },
  },
}

/**
 * Several grounds at once: a score, a category nothing fits, a warning with the
 * signal under it, and the priority policy raised. Each reads as itself, so a
 * reader can tell a low score from a possible scam.
 */
export const SeveralGrounds: Story = {
  args: {
    score: 41,
    reason:
      'Triage policy asked for a person on the grounds below. Each is a rule over the scores, not the model’s own account of itself, and none of them says whether this triage still describes the mail as it stands now.',
    reasons: [
      "The model's score for this category stayed under the level triage accepts on its own.",
      'The model answered Other, which means either that no category of the rubric clearly fits or that the thread does not hold enough to tell. The record does not say which.',
      'Triage read this mail as a possible scam or phishing attempt.',
      'Possible signal: It may ask to send money or to change payment details.',
      'Triage raised how urgent a look is, which asks for attention sooner and nothing else.',
    ],
  },
}

/**
 * A record that names no grounds. The panel says so instead of explaining the
 * review as model doubt, and still offers both decisions.
 */
export const GroundsNotRecorded: Story = {
  args: {
    reason:
      'Triage policy asked for a person, but what was stored does not say on what grounds. It was written without them, or by a build whose grounds this one cannot read, so none is shown rather than guessed at.',
    reasons: [],
  },
}

const dutchCategoryOptions: readonly ReviewFieldOption[] = [
  { value: 'klantvraag', label: 'Klantvraag' },
  { value: 'factuur', label: 'Factuur' },
  { value: 'nieuwsbrief', label: 'Nieuwsbrief', note: 'Het advies van het model' },
  { value: 'persoonlijk', label: 'Persoonlijk' },
  { value: 'overig', label: 'Overig: past niet in een van de bovenstaande categorieën' },
]

const dutchPriorityOptions: readonly ReviewFieldOption[] = [
  { value: 'urgent', label: 'Urgent' },
  { value: 'hoog', label: 'Hoog', note: 'Het advies van het model' },
  { value: 'normaal', label: 'Normaal' },
  { value: 'laag', label: 'Laag' },
]

/** Dutch copy with long words and sentences. Everything wraps; nothing scrolls sideways. */
export const LongDutchCopy: Story = {
  args: {
    title: 'Controle nodig',
    summary:
      'Vergelijk wat het model adviseerde met wat jij beslist, veld voor veld. Dit verandert niets in je mail.',
    scoreLabel: 'Modelscore',
    score: 58,
    reasonTitle: 'Waarom controleren?',
    reason:
      'De mail bevat planningstaal over de leveranciersovereenkomstwijzigingsvoorstellen, maar de afzender vraagt expliciet om een antwoord en een besluit vóór vrijdag.',
    reasons: [
      'De modelscore voor deze leveranciersovereenkomstwijzigingscategorie bleef onder de drempel die triage zonder mens accepteert.',
      'Mogelijk signaal: er wordt misschien gevraagd om geld over te maken of betaalgegevens te wijzigen.',
    ],
    keptNote: 'Het oorspronkelijke advies van het model blijft bewaard, wat je ook beslist.',
    fieldsTitle: 'Het advies van het model en jouw beslissing',
    fieldsHint:
      'Kies de waarde met het label van het model om die te bevestigen, of een andere om die te wijzigen. Een veld dat je niet aanraakt blijft onbeoordeeld.',
    cells: { advice: 'Model adviseert', decision: 'Jouw beslissing', decidedBy: 'Beslist door' },
    outOfScope:
      'Dit paneel beslist alleen over categorie en prioriteit. Of er een antwoord wordt verwacht, en wanneer, wordt hier niet bevestigd.',
    fields: [
      {
        name: 'category',
        label: 'Categorie',
        advice: 'Nieuwsbrief',
        options: dutchCategoryOptions,
        chosen: 'klantvraag',
        onChoose: fn(),
        state: { label: 'Wijzigen naar Klantvraag. Nog niet opgeslagen.', tone: 'pending' },
        decidedBy: 'Niemand. Het model besliste dit.',
        undoLabel: 'Ongedaan maken',
        onUndo: fn(),
      },
      {
        name: 'priority',
        label: 'Prioriteit',
        advice: 'Hoog',
        adviceNote: 'Het model was hier niet zeker van.',
        options: dutchPriorityOptions,
        chosen: null,
        onChoose: fn(),
        state: { label: 'Niet beoordeeld', tone: 'none' },
        decidedBy: 'Niemand. Het model besliste dit.',
        undoLabel: 'Ongedaan maken',
      },
    ],
    saveLabel: '1 veld opslaan',
    saveDisabled: false,
    result: {
      title: '1 veld klaar om op te slaan',
      detail: 'Opslaan legt dit vast op deze computer. Je mailbox blijft ongewijzigd.',
    },
  },
}

/** A 320px phone: every row stacks, options wrap and save fills the width. */
export const NarrowViewport: Story = {
  ...LongDutchCopy,
  globals: { viewport: { value: 'mobile1', isRotated: false } },
}
