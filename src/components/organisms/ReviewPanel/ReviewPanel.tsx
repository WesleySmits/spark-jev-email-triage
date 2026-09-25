import { useId } from 'react'
import { Button } from '../../atoms/Button/Button'
import { Icon } from '../../atoms/Icon/Icon'
import { CategoryOption } from '../../molecules/CategoryOption/CategoryOption'
import './ReviewPanel.css'

export type ReviewFieldOption = Readonly<{
  value: string
  label: string
  /** Shown and announced beside the label, e.g. "Jev's advice". */
  note?: string | undefined
  disabled?: boolean | undefined
}>

/**
 * What one field's row amounts to right now, in words. The tone only tints
 * what the words already say, so nothing here is carried by colour alone.
 */
export type ReviewFieldState = Readonly<{
  label: string
  tone: 'none' | 'pending' | 'saved'
}>

/** One reviewable field: what was advised, what is chosen, and who decided it. */
export type ReviewField = Readonly<{
  /** Stable key. Also groups this field's options, so two fields never share one. */
  name: string
  label: string
  /** What the classifier advised for this field, as it reads. */
  advice: string
  /** One line under the advice, e.g. that the classifier was unsure of it. */
  adviceNote?: string | undefined
  options: readonly ReviewFieldOption[]
  /** The option shown as chosen, or `null` where this field is undecided. */
  chosen: string | null
  onChoose: (value: string) => void
  state: ReviewFieldState
  /** Who decided this field and when, where anyone has. */
  decidedBy: string
  /** Offered only while this field holds a choice that is not stored yet. */
  onUndo?: (() => void) | undefined
  undoLabel: string
  disabled?: boolean | undefined
}>

type HeadingLevel = 2 | 3 | 4

type ReviewPanelProps = Readonly<{
  /** Level of the panel heading. The section heading sits one below. Defaults to 2. */
  headingLevel?: HeadingLevel | undefined
  /** Names the panel and its disclosure button, e.g. "Needs review". */
  title: string
  /** One line under the title, announced as the button's description. */
  summary: string
  /** Whether the reason and the fields show. The caller owns this state. */
  expanded: boolean
  /** Called with the next state when the heading button is pressed. */
  onExpandedChange: (expanded: boolean) => void
  /** Text before the score, e.g. "Model score". */
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
  /** One line saying the advice is kept whatever a person decides. */
  keptNote: string
  /** Visible heading that names the group of fields. */
  fieldsTitle: string
  /** Announced as the group's description. */
  fieldsHint?: string | undefined
  /** How each cell of a field row is named. */
  cells: Readonly<{ advice: string; decision: string; decidedBy: string }>
  fields: readonly ReviewField[]
  /** One line under the fields, e.g. what this panel never decides. */
  outOfScope?: string | undefined
  saveLabel: string
  onSave: () => void
  /** Save is disabled whenever the caller says nothing is there to save. */
  saveDisabled?: boolean | undefined
  /** Result copy next to the save button. Not a live region: announce it yourself. */
  result?: Readonly<{ title: string; detail?: string | undefined }> | undefined
}>

const subheadings = { 2: 'h3', 3: 'h4', 4: 'h5' } as const

function formatScore(score: number) {
  return `${String(Math.min(100, Math.max(0, Math.round(score))))}/100`
}

type ContextProps = Pick<ReviewPanelProps, 'scoreLabel' | 'score' | 'reasonTitle' | 'reason'> & {
  Subheading: (typeof subheadings)[HeadingLevel]
  reasons: readonly string[]
  keptNote: string
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
      <p className="review-panel__note">{props.keptNote}</p>
    </div>
  )
}

type FieldProps = Readonly<{
  field: ReviewField
  cells: ReviewPanelProps['cells']
}>

/**
 * One field's row: the classifier's advice, the decision, and who decided it.
 *
 * The three cells sit side by side while there is room and stack when there is
 * not. Each carries its own visible name, so a stacked row says what every
 * value is without a column heading to look back to.
 */
function ReviewFieldRow({ field, cells }: FieldProps) {
  const id = useId()
  const nameId = `${id}-name`
  const decisionId = `${id}-decision`
  const stateId = `${id}-state`
  return (
    <div className="review-panel__field">
      <span id={nameId} className="review-panel__field-name">
        {field.label}
      </span>
      <div className="review-panel__cell">
        <span className="review-panel__cell-name">{cells.advice}</span>
        <span className="review-panel__advice">{field.advice}</span>
        {field.adviceNote && <span className="review-panel__cell-note">{field.adviceNote}</span>}
      </div>
      <div className="review-panel__cell review-panel__cell--decision">
        <span id={decisionId} className="review-panel__cell-name">
          {cells.decision}
        </span>
        <div
          className="review-panel__options"
          role="radiogroup"
          aria-labelledby={`${nameId} ${decisionId}`}
          aria-describedby={stateId}
        >
          {field.options.map((option) => (
            <CategoryOption
              key={option.value}
              className="review-panel__option"
              name={`${id}-option`}
              value={option.value}
              label={option.label}
              description={option.note}
              disabled={field.disabled === true || option.disabled === true}
              checked={field.chosen === option.value}
              onChange={() => {
                field.onChoose(option.value)
              }}
            />
          ))}
        </div>
        <p id={stateId} className={`review-panel__state review-panel__state--${field.state.tone}`}>
          {field.state.label}
        </p>
        {field.onUndo && (
          <Button
            className="review-panel__undo"
            variant="quiet"
            disabled={field.disabled === true}
            onClick={field.onUndo}
          >
            {field.undoLabel}
          </Button>
        )}
      </div>
      <div className="review-panel__cell">
        <span className="review-panel__cell-name">{cells.decidedBy}</span>
        <span className="review-panel__cell-note">{field.decidedBy}</span>
      </div>
    </div>
  )
}

type FieldsProps = Pick<
  ReviewPanelProps,
  | 'fieldsTitle'
  | 'fieldsHint'
  | 'cells'
  | 'fields'
  | 'outOfScope'
  | 'saveLabel'
  | 'onSave'
  | 'result'
> & {
  Subheading: ContextProps['Subheading']
  saveDisabled: boolean
}

function ReviewFields({ Subheading, ...props }: FieldsProps) {
  const id = useId()
  const titleId = `${id}-title`
  const hintId = props.fieldsHint ? `${id}-hint` : undefined
  return (
    <div className="review-panel__controls">
      <Subheading id={titleId} className="review-panel__subheading">
        {props.fieldsTitle}
      </Subheading>
      {props.fieldsHint && (
        <p id={hintId} className="review-panel__hint">
          {props.fieldsHint}
        </p>
      )}
      <div className="review-panel__fields" aria-labelledby={titleId} aria-describedby={hintId}>
        {props.fields.map((field) => (
          <ReviewFieldRow key={field.name} field={field} cells={props.cells} />
        ))}
      </div>
      {props.outOfScope && <p className="review-panel__hint">{props.outOfScope}</p>}
      <div className="review-panel__actions">
        <Button className="review-panel__save" disabled={props.saveDisabled} onClick={props.onSave}>
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
 * The amber review panel for one stored classification: why a person was
 * asked, the model score, and one row per reviewable field with what the
 * classifier advised beside what a person decided.
 *
 * It is fully controlled and presentational: the caller owns the expanded
 * state, every choice, the saving, the result copy and any live announcement.
 * The caller also owns which fields there are, so this panel never assumes
 * that a classification has any particular field to review.
 *
 * Nothing here decides anything by omission. A field whose `chosen` is `null`
 * reads as undecided in its own words, and only the caller can make a choice
 * count. Below 700px of container width the rows stack.
 *
 * @example
 * import { ReviewPanel } from '../components/organisms/ReviewPanel/ReviewPanel'
 *
 * <ReviewPanel
 *   title="Needs review"
 *   summary="Confirm or correct what the model decided, field by field."
 *   expanded={expanded}
 *   onExpandedChange={setExpanded}
 *   scoreLabel="Model score"
 *   score={58}
 *   reasonTitle="Why review?"
 *   reason="The sender asks for a decision."
 *   keptNote="The model's advice is kept whatever you decide."
 *   fieldsTitle="Advice and your decision"
 *   cells={{ advice: 'Model advises', decision: 'Your decision', decidedBy: 'Decided by' }}
 *   fields={[categoryField, priorityField]}
 *   saveLabel="Save 1 field"
 *   onSave={save}
 *   result={{ title: 'Not saved yet' }}
 * />
 */
export function ReviewPanel({
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
  keptNote,
  saveDisabled = false,
  ...fields
}: ReviewPanelProps) {
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
          keptNote={keptNote}
        />
        <ReviewFields Subheading={Subheading} saveDisabled={saveDisabled} {...fields} />
      </div>
    </section>
  )
}
