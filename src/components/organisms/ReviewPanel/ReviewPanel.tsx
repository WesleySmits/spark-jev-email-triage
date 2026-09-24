import { useId } from 'react'
import { Button } from '../../atoms/Button/Button'
import { Icon } from '../../atoms/Icon/Icon'
import { CategoryOption } from '../../molecules/CategoryOption/CategoryOption'
import './ReviewPanel.css'

export type ReviewCategory<Value extends string> = Readonly<{
  value: Value
  label: string
  description?: string | undefined
  disabled?: boolean | undefined
}>

type HeadingLevel = 2 | 3 | 4

type ReviewPanelProps<Value extends string> = Readonly<{
  /** Level of the panel heading. The two section headings sit one below. Defaults to 2. */
  headingLevel?: HeadingLevel | undefined
  /** Names the panel and its disclosure button, e.g. "Controle nodig". */
  title: string
  /** One line under the title, announced as the button's description. */
  summary: string
  /** Whether the reason and categories show. The caller owns this state. */
  expanded: boolean
  /** Called with the next state when the heading button is pressed. */
  onExpandedChange: (expanded: boolean) => void
  /** Text before the score, e.g. "Modelscore". */
  scoreLabel: string
  /** Model score from 0 to 100, shown rounded as "58/100". */
  score: number
  reasonTitle: string
  reason: string
  /**
   * One line per ground under `reason`, e.g. why review was asked for. Every
   * line is the caller's own copy and shown as text; leave it out for none.
   */
  reasons?: readonly string[] | undefined
  originalLabel: string
  /** The model's first category. Stays visible after any correction. */
  originalSuggestion: string
  originalNote?: string | undefined
  /** Visible heading that names the radiogroup. */
  categoriesTitle: string
  /** Announced as the radiogroup's description. */
  categoriesHint?: string | undefined
  categories: readonly ReviewCategory<Value>[]
  /** The checked category, or null when none is. The caller owns this state. */
  selectedCategory: Value | null
  onSelectedCategoryChange: (value: Value) => void
  saveLabel: string
  onSave: () => void
  /** Save is always disabled while no category is selected. */
  saveDisabled?: boolean | undefined
  /** Result copy next to the save button. Not a live region: announce it yourself. */
  result?: Readonly<{ title: string; detail?: string | undefined }> | undefined
}>

const subheadings = { 2: 'h3', 3: 'h4', 4: 'h5' } as const

function formatScore(score: number) {
  return `${String(Math.min(100, Math.max(0, Math.round(score))))}/100`
}

type ContextProps = Pick<
  ReviewPanelProps<string>,
  'scoreLabel' | 'score' | 'reasonTitle' | 'reason' | 'originalLabel' | 'originalSuggestion'
> & {
  Subheading: (typeof subheadings)[HeadingLevel]
  originalNote: string | undefined
  reasons: readonly string[]
}

/** The lead sits closer to its own grounds than to what follows them. */
const leadWithGrounds = 'review-panel__reason review-panel__reason--leads-grounds'

function ReviewContext({ Subheading, ...props }: ContextProps) {
  return (
    <div className="review-panel__context">
      <p className="review-panel__score">
        <Icon name="alert" size="sm" />
        {props.scoreLabel} · {formatScore(props.score)}
      </p>
      <Subheading className="review-panel__subheading">{props.reasonTitle}</Subheading>
      <p className={props.reasons.length > 0 ? leadWithGrounds : 'review-panel__reason'}>
        {props.reason}
      </p>
      {props.reasons.length > 0 && (
        <ul className="review-panel__grounds">
          {props.reasons.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
      <dl className="review-panel__original">
        <dt>{props.originalLabel}</dt>
        <dd>{props.originalSuggestion}</dd>
      </dl>
      {props.originalNote && <p className="review-panel__note">{props.originalNote}</p>}
    </div>
  )
}

type ControlsProps<Value extends string> = Omit<
  ReviewPanelProps<Value>,
  'headingLevel' | 'title' | 'summary' | 'expanded' | 'onExpandedChange' | keyof ContextProps
> & { Subheading: ContextProps['Subheading'] }

function ReviewControls<Value extends string>({ Subheading, ...props }: ControlsProps<Value>) {
  const id = useId()
  const titleId = `${id}-title`
  const hintId = props.categoriesHint ? `${id}-hint` : undefined
  return (
    <div className="review-panel__controls">
      <Subheading id={titleId} className="review-panel__subheading">
        {props.categoriesTitle}
      </Subheading>
      {props.categoriesHint && (
        <p id={hintId} className="review-panel__hint">
          {props.categoriesHint}
        </p>
      )}
      <div
        className="review-panel__categories"
        role="radiogroup"
        aria-labelledby={titleId}
        aria-describedby={hintId}
      >
        {props.categories.map((category) => (
          <CategoryOption
            key={category.value}
            {...category}
            name={`${id}-category`}
            checked={props.selectedCategory === category.value}
            onChange={() => {
              props.onSelectedCategoryChange(category.value)
            }}
          />
        ))}
      </div>
      <div className="review-panel__actions">
        <Button
          className="review-panel__save"
          disabled={props.saveDisabled === true || props.selectedCategory === null}
          onClick={props.onSave}
        >
          <Icon name="check" />
          {props.saveLabel}
        </Button>
        {props.result && (
          <p className="review-panel__result">
            <strong>{props.result.title}</strong>
            {props.result.detail && <span>{props.result.detail}</span>}
          </p>
        )}
      </div>
    </div>
  )
}

/**
 * The amber review panel for an uncertain classification: why it needs a
 * person, with one line per ground the caller gives, the model score, the
 * preserved original AI suggestion, a category radiogroup and one save action. It is fully controlled and presentational:
 * the caller owns the expanded state, the selection, saving, the result copy
 * and any live announcement. Below 560px of container width it stacks.
 *
 * @example
 * import { ReviewPanel } from '../components/organisms/ReviewPanel/ReviewPanel'
 *
 * <ReviewPanel
 *   title="Controle nodig"
 *   summary="De inhoud en voorgestelde categorie sluiten niet duidelijk op elkaar aan."
 *   expanded={expanded}
 *   onExpandedChange={setExpanded}
 *   scoreLabel="Modelscore"
 *   score={58}
 *   reasonTitle="Waarom controleren?"
 *   reason="De afzender vraagt expliciet om een antwoord en een besluit."
 *   reasons={['Modelscore voor deze categorie bleef onder de drempel.']}
 *   originalLabel="Originele AI-suggestie"
 *   originalSuggestion="Nieuwsbrief"
 *   categoriesTitle="Kies de juiste categorie"
 *   categories={[{ value: 'klantvraag', label: 'Klantvraag' }, { value: 'nieuwsbrief', label: 'Nieuwsbrief' }]}
 *   selectedCategory={selected}
 *   onSelectedCategoryChange={setSelected}
 *   saveLabel="Beoordeling opslaan"
 *   onSave={save}
 *   result={{ title: 'Nog niet opgeslagen' }}
 * />
 */
export function ReviewPanel<Value extends string>({
  headingLevel = 2,
  title,
  summary,
  expanded,
  onExpandedChange,
  scoreLabel,
  score,
  reasonTitle,
  reason,
  reasons = [],
  originalLabel,
  originalSuggestion,
  originalNote,
  ...controls
}: ReviewPanelProps<Value>) {
  const id = useId()
  const titleId = `${id}-title`
  const summaryId = `${id}-summary`
  const contentId = `${id}-content`
  const Heading = `h${String(headingLevel)}` as `h${HeadingLevel}`
  const Subheading = subheadings[headingLevel]
  return (
    <section className="review-panel" aria-labelledby={titleId}>
      <Heading className="review-panel__heading">
        <button
          className="review-panel__toggle"
          type="button"
          aria-expanded={expanded}
          aria-controls={contentId}
          aria-labelledby={titleId}
          aria-describedby={summaryId}
          onClick={() => {
            onExpandedChange(!expanded)
          }}
        >
          <Icon name="alert" />
          <span className="review-panel__heading-copy">
            <span id={titleId} className="review-panel__title">
              {title}
            </span>
            <span id={summaryId} className="review-panel__summary">
              {summary}
            </span>
          </span>
          <span className="review-panel__chevron">
            <Icon name="chevron" />
          </span>
        </button>
      </Heading>
      <div id={contentId} className="review-panel__content" hidden={!expanded}>
        <ReviewContext
          Subheading={Subheading}
          scoreLabel={scoreLabel}
          score={score}
          reasonTitle={reasonTitle}
          reason={reason}
          reasons={reasons}
          originalLabel={originalLabel}
          originalSuggestion={originalSuggestion}
          originalNote={originalNote}
        />
        <ReviewControls Subheading={Subheading} {...controls} />
      </div>
    </section>
  )
}
