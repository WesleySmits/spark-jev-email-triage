import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState, type ComponentProps } from 'react'
import { useArgs } from 'storybook/preview-api'
import { fn } from 'storybook/test'
import { ReviewPanel, type ReviewCategory } from './ReviewPanel'

type Props = ComponentProps<typeof ReviewPanel<string>>

const categories: readonly ReviewCategory<string>[] = [
  { value: 'customer-question', label: 'Customer question' },
  { value: 'invoice', label: 'Invoice' },
  { value: 'newsletter', label: 'Newsletter' },
  { value: 'personal', label: 'Personal' },
]

// What the caller would say after each step, per story language.
const feedback = {
  en: {
    unsaved: { title: 'Not saved yet', detail: 'Saving records your category locally.' },
    saved: (label: string) => `Saved: ${label}`,
    same: 'Matches the original suggestion.',
    changed: (original: string) => `The original stays ${original}.`,
    announce: (label: string) => `Review saved. Category set to ${label}. Not completed yet.`,
  },
  nl: {
    unsaved: {
      title: 'Nog niet opgeslagen',
      detail: 'Klantvragen gaan na het opslaan naar Actie nodig.',
    },
    saved: (label: string) => `Opgeslagen: ${label}`,
    same: 'Komt overeen met de oorspronkelijke suggestie.',
    changed: (original: string) => `Origineel blijft ${original}.`,
    announce: (label: string) =>
      `Beoordeling opgeslagen. Categorie ingesteld op ${label}. Nog niet afgehandeld.`,
  },
}

type Language = keyof typeof feedback

const meta = {
  title: 'Organisms/Review panel',
  component: ReviewPanel,
  args: {
    headingLevel: 2,
    title: 'Needs review',
    summary: "The content and the suggested category don't clearly match.",
    expanded: true,
    scoreLabel: 'Model score',
    score: 58,
    reasonTitle: 'Why review?',
    reason:
      'The message uses scheduling language, but the sender explicitly asks for an answer and a decision.',
    originalLabel: 'Original AI suggestion',
    originalSuggestion: 'Newsletter',
    originalNote: 'This original suggestion is kept, even after later corrections.',
    categoriesTitle: 'Choose the right category',
    categoriesHint: "This reviews the message. It doesn't complete it.",
    categories,
    selectedCategory: null,
    saveLabel: 'Save review',
    saveDisabled: false,
    result: feedback.en.unsaved,
    onExpandedChange: fn(),
    onSelectedCategoryChange: fn(),
    onSave: fn(),
  },
  argTypes: {
    headingLevel: { control: 'inline-radio', options: [2, 3, 4] },
    score: { control: { type: 'range', min: 0, max: 100, step: 1 } },
    selectedCategory: {
      control: 'select',
      options: [null, ...categories.map((category) => category.value)],
    },
    categories: { control: 'object' },
    result: { control: 'object' },
  },
  render: function Render(args, { parameters }) {
    const [, updateArgs] = useArgs<Props>()
    const language: Language = parameters['language'] === 'nl' ? 'nl' : 'en'
    return <ReviewFixture {...args} language={language} updateArgs={updateArgs} />
  },
  // The source reader gives the panel at most 820px.
  decorators: [
    (Story) => (
      <div style={{ maxWidth: 820 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ReviewPanel<string>>

export default meta

type Story = StoryObj<typeof meta>

function labelOf(args: Props, value: string | null) {
  return args.categories.find((category) => category.value === value)?.label ?? ''
}

/**
 * Stands in for the caller: it keeps expanded, selection and result in the
 * story args (so the controls follow along), and announces a save through its
 * own polite live region. The panel itself announces nothing.
 */
type FixtureProps = Props & {
  language: Language
  updateArgs: (args: Partial<Props>) => void
}

function ReviewFixture({ language, updateArgs, ...args }: FixtureProps) {
  const [announcement, setAnnouncement] = useState('')
  const copy = feedback[language]
  return (
    <div style={{ display: 'grid', gap: 'var(--s3)' }}>
      <ReviewPanel
        {...args}
        onExpandedChange={(expanded) => {
          args.onExpandedChange(expanded)
          updateArgs({ expanded })
        }}
        onSelectedCategoryChange={(value) => {
          args.onSelectedCategoryChange(value)
          updateArgs({ selectedCategory: value, result: copy.unsaved })
        }}
        onSave={() => {
          args.onSave()
          const label = labelOf(args, args.selectedCategory)
          const detail =
            label === args.originalSuggestion ? copy.same : copy.changed(args.originalSuggestion)
          updateArgs({ result: { title: copy.saved(label), detail } })
          setAnnouncement(copy.announce(label))
        }}
      />
      <p role="status" aria-live="polite" style={{ margin: 0, font: 'var(--text-meta)' }}>
        {announcement}
      </p>
    </div>
  )
}

/**
 * Nothing selected yet, so save is disabled. Pick a category and save: the
 * result copy changes and the story's live region announces it.
 *
 * ```tsx
 * const [expanded, setExpanded] = useState(true)
 * const [selected, setSelected] = useState<Category | null>(null)
 *
 * <ReviewPanel
 *   title="Needs review"
 *   summary="The content and the suggested category don't clearly match."
 *   expanded={expanded}
 *   onExpandedChange={setExpanded}
 *   scoreLabel="Model score"
 *   score={58}
 *   reasonTitle="Why review?"
 *   reason="The sender explicitly asks for an answer and a decision."
 *   originalLabel="Original AI suggestion"
 *   originalSuggestion="Newsletter"
 *   categoriesTitle="Choose the right category"
 *   categories={categories}
 *   selectedCategory={selected}
 *   onSelectedCategoryChange={setSelected}
 *   saveLabel="Save review"
 *   onSave={save}
 *   result={{ title: 'Not saved yet' }}
 * />
 * <p role="status" aria-live="polite">{announcement}</p>
 * ```
 */
export const Expanded: Story = {}

export const Collapsed: Story = { args: { expanded: false } }

export const Selected: Story = { args: { selectedCategory: 'customer-question' } }

/** After saving: the result names the new category and the original suggestion stays. */
export const Saved: Story = {
  args: {
    selectedCategory: 'customer-question',
    result: { title: 'Saved: Customer question', detail: 'The original stays Newsletter.' },
  },
}

const dutchCategories: readonly ReviewCategory<string>[] = [
  {
    value: 'klantvraag',
    label: 'Klantvraag',
    description: 'Iemand vraagt om een antwoord of een besluit.',
  },
  { value: 'factuur', label: 'Factuur' },
  { value: 'nieuwsbrief', label: 'Nieuwsbrief' },
  { value: 'persoonlijk', label: 'Persoonlijk' },
  {
    value: 'overig',
    label: 'Overig: past niet in een van de bovenstaande categorieën',
    description: 'Bijvoorbeeld een automatische ontvangstbevestiging van een leveranciersportaal.',
  },
]

/** Dutch copy with long words and sentences. Everything wraps; nothing scrolls sideways. */
export const LongDutchCopy: Story = {
  args: {
    title: 'Controle nodig',
    summary:
      'De inhoud en de voorgestelde categorie sluiten niet duidelijk op elkaar aan, dus een mens beslist.',
    scoreLabel: 'Modelscore',
    score: 58,
    reasonTitle: 'Waarom controleren?',
    reason:
      'De mail bevat planningstaal over de leveranciersovereenkomstwijzigingsvoorstellen, maar de afzender vraagt expliciet om een antwoord en een besluit vóór vrijdag.',
    originalLabel: 'Originele AI-suggestie',
    originalSuggestion: 'Nieuwsbrief',
    originalNote: 'Deze oorspronkelijke suggestie blijft bewaard, ook na latere correcties.',
    categoriesTitle: 'Kies de juiste categorie',
    categoriesHint: 'Dit beoordeelt de mail. Het handelt de mail nog niet af.',
    categories: dutchCategories,
    selectedCategory: 'klantvraag',
    saveLabel: 'Beoordeling opslaan',
    result: feedback.nl.unsaved,
  },
  parameters: { language: 'nl' },
  argTypes: {
    selectedCategory: {
      control: 'select',
      options: [null, ...dutchCategories.map((category) => category.value)],
    },
  },
}

/** A 320px phone: the panel stacks, options take one column and save fills the width. */
export const NarrowViewport: Story = {
  ...LongDutchCopy,
  globals: { viewport: { value: 'mobile1', isRotated: false } },
}
