import type { Meta, StoryObj } from '@storybook/react-vite'
import { useId, useState } from 'react'
import { fn } from 'storybook/test'
import { CategoryOption } from './CategoryOption'

const meta = {
  title: 'Molecules/Category option',
  component: CategoryOption,
  args: {
    name: 'category',
    value: 'customer-question',
    label: 'Customer question',
    description: '',
    checked: false,
    disabled: false,
    onChange: fn(),
  },
  argTypes: {
    label: { control: 'text' },
    description: { control: 'text' },
    checked: { control: 'boolean' },
    disabled: { control: 'boolean' },
  },
  // The source review panel gives each option half of a column of about 400px.
  render: (args) => (
    <div style={{ maxWidth: 240 }}>
      <CategoryOption {...args} />
    </div>
  ),
} satisfies Meta<typeof CategoryOption>

export default meta

type Story = StoryObj<typeof meta>

/** A lone option. The caller owns `checked`; this story sets it with the control. */
export const Unchecked: Story = {}

export const Checked: Story = { args: { checked: true } }

export const WithDescription: Story = {
  args: { description: 'Someone asks for an answer or a decision.' },
}

export const Disabled: Story = { args: { disabled: true } }

export const DisabledChecked: Story = { args: { disabled: true, checked: true } }

const categories = [
  {
    value: 'klantvraag',
    label: 'Klantvraag',
    description: 'Iemand vraagt om een antwoord of een besluit.',
  },
  { value: 'factuur', label: 'Factuur' },
  { value: 'nieuwsbrief', label: 'Nieuwsbrief' },
  { value: 'persoonlijk', label: 'Persoonlijk', disabled: true },
  {
    value: 'overig',
    label: 'Overig: past niet in een van de bovenstaande categorieën',
    description:
      'Gebruik dit alleen als de mail echt nergens anders thuishoort, bijvoorbeeld een automatische ontvangstbevestiging van een leveranciersportaal.',
  },
] as const

type Category = (typeof categories)[number]['value']

function CategoryGroup() {
  const headingId = useId()
  const [selected, setSelected] = useState<Category>('klantvraag')
  return (
    <div style={{ display: 'grid', gap: 'var(--s3)', font: 'var(--text-ui)', maxWidth: 480 }}>
      <h3 id={headingId} style={{ margin: 0, fontSize: 14 }}>
        Kies de juiste categorie
      </h3>
      <div
        role="radiogroup"
        aria-labelledby={headingId}
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 200px), 1fr))',
          gap: 'var(--s2)',
        }}
      >
        {categories.map((category) => (
          <CategoryOption
            key={category.value}
            name="review-category"
            {...category}
            checked={selected === category.value}
            onChange={() => {
              setSelected(category.value)
            }}
          />
        ))}
      </div>
      <p style={{ margin: 0, color: 'var(--muted)' }}>Gekozen: {selected}</p>
    </div>
  )
}

/**
 * A labelled radiogroup, as in the review panel. Tab enters the group at the
 * checked option and arrow keys move the selection. Persoonlijk is disabled.
 *
 * ```tsx
 * <div role="radiogroup" aria-labelledby={headingId}>
 *   {categories.map((category) => (
 *     <CategoryOption
 *       key={category.value}
 *       name="review-category"
 *       {...category}
 *       checked={selected === category.value}
 *       onChange={() => setSelected(category.value)}
 *     />
 *   ))}
 * </div>
 * ```
 */
export const RadioGroup: Story = {
  render: () => <CategoryGroup />,
}
