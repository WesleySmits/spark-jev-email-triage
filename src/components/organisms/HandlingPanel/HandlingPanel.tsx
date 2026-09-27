import { useId, type ComponentProps } from 'react'
import { Badge } from '../../atoms/Badge/Badge'
import { Button } from '../../atoms/Button/Button'
import { CategoryOption } from '../../molecules/CategoryOption/CategoryOption'
import './HandlingPanel.css'

type HeadingLevel = 2 | 3 | 4

type BadgeTone = ComponentProps<typeof Badge>['tone']

/** One outcome a person may choose for the open message. */
export type HandlingOptionView = Readonly<{
  value: string
  label: string
  /** What choosing it changes, announced as the option's description. */
  effect: string
  /** Offered and refused rather than hidden, so `effect` says why. */
  disabled?: boolean | undefined
}>

/** The decision as it stands once recorded, and how to go back on it. */
type RecordedDecisionView = Readonly<{
  /** What was decided, e.g. "Reply needed". */
  title: string
  /** Where that decision stands now, including a Spark attempt that did not settle. */
  detail: string
  state: Readonly<{ label: string; tone: BadgeTone }>
  changeLabel: string
  onChange: () => void
  /** Refused while an attempt on this message is locked. `detail` says so. */
  changeDisabled?: boolean | undefined
}>

type HandlingPanelProps = Readonly<{
  /** Level of the panel heading. Defaults to 2. */
  headingLevel?: HeadingLevel | undefined
  /** Names the panel, e.g. "What happens next?". */
  title: string
  /** One line under the title, announced as the group's description. */
  summary: string
  /** The outcomes offered, in the order they are shown. */
  options: readonly HandlingOptionView[]
  /** The option shown as chosen, or `null` while nothing is chosen. */
  chosen: string | null
  onChoose: (value: string) => void
  /** One line under the options, e.g. what this records and what it does not. */
  note: string
  recordLabel: string
  onRecord: () => void
  /** Recording is refused whenever the caller says there is nothing to record. */
  recordDisabled?: boolean | undefined
  /** The recorded decision, which replaces the chooser while it stands. */
  recorded?: RecordedDecisionView | undefined
  /** Short tags naming what this panel changes. Words only; never colour alone. */
  tags?: readonly string[] | undefined
  /** Result copy beside the button. Not a live region: announce it yourself. */
  result?: Readonly<{ title: string; detail?: string | undefined }> | undefined
  className?: string | undefined
}>

/**
 * The handling step for the open message: which of the offered outcomes a
 * person owes this mail, and what recording that changes.
 *
 * Presentational and fully controlled. The caller owns every string, the
 * chosen option, what recording does and any announcement; nothing here
 * records a decision, proposes an action, reads a store or touches a
 * mailbox. It names no subject, address or body, and it never says a message
 * was handled: only the caller's `recorded` copy can say where a decision
 * stands. Below 560px of container width the options stack.
 *
 * @example
 * import { HandlingPanel } from '../components/organisms/HandlingPanel/HandlingPanel'
 *
 * <HandlingPanel
 *   title="What happens next?"
 *   summary="Choose the work owed for this exact message version."
 *   options={[
 *     { value: 'handle_now', label: 'Handle now', effect: 'Propose guarded Spark Done' },
 *     { value: 'reply_needed', label: 'Reply needed', effect: 'Keep local work open' },
 *   ]}
 *   chosen={chosen}
 *   onChoose={setChosen}
 *   note="The local outcomes move no mail."
 *   recordLabel="Record decision"
 *   onRecord={record}
 *   tags={['Decision', 'Local work status', 'Spark unchanged']}
 * />
 */
export function HandlingPanel({
  headingLevel = 2,
  title,
  summary,
  options,
  chosen,
  onChoose,
  note,
  recordLabel,
  onRecord,
  recordDisabled = false,
  recorded,
  tags = [],
  result,
  className,
}: HandlingPanelProps) {
  const id = useId()
  const titleId = `${id}-title`
  const summaryId = `${id}-summary`
  const Heading = `h${String(headingLevel)}` as `h${HeadingLevel}`
  const classes = ['handling-panel', className].filter(Boolean).join(' ')
  return (
    <section className={classes} aria-labelledby={titleId}>
      <div className="handling-panel__head">
        <Heading className="handling-panel__title" id={titleId}>
          {title}
        </Heading>
        <p className="handling-panel__summary" id={summaryId}>
          {summary}
        </p>
      </div>
      {recorded ? (
        <RecordedDecision decision={recorded} />
      ) : (
        <OutcomeChooser
          group={{ name: `${id}-outcome`, titleId, summaryId }}
          options={options}
          chosen={chosen}
          onChoose={onChoose}
          note={note}
          recordLabel={recordLabel}
          onRecord={onRecord}
          recordDisabled={recordDisabled}
          result={result}
        />
      )}
      <Tags tags={tags} />
    </section>
  )
}

type ChooserProps = Pick<
  HandlingPanelProps,
  'options' | 'chosen' | 'onChoose' | 'note' | 'recordLabel' | 'onRecord' | 'result'
> &
  Readonly<{
    /** What names the radiogroup and what groups its radios. */
    group: Readonly<{ name: string; titleId: string; summaryId: string }>
    recordDisabled: boolean
  }>

/** The outcomes on offer, what each changes, and the one way to record one. */
function OutcomeChooser({ group, options, chosen, onChoose, ...props }: ChooserProps) {
  return (
    <>
      <div
        className="handling-panel__options"
        role="radiogroup"
        aria-labelledby={group.titleId}
        aria-describedby={group.summaryId}
      >
        {options.map((option) => (
          <CategoryOption
            key={option.value}
            className="handling-panel__option"
            name={group.name}
            value={option.value}
            label={option.label}
            description={option.effect}
            disabled={option.disabled ?? false}
            checked={chosen === option.value}
            onChange={() => {
              onChoose(option.value)
            }}
          />
        ))}
      </div>
      <p className="handling-panel__note">{props.note}</p>
      <div className="handling-panel__actions">
        <Button disabled={props.recordDisabled} onClick={props.onRecord}>
          {props.recordLabel}
        </Button>
        {props.result && (
          <p className="handling-panel__result">
            <strong>{props.result.title}</strong>
            {props.result.detail && <span>{props.result.detail}</span>}
          </p>
        )}
      </div>
    </>
  )
}

/** What this panel changes, as words, or nothing where it names none. */
function Tags({ tags }: Readonly<{ tags: readonly string[] }>) {
  if (tags.length === 0) return null
  return (
    <ul className="handling-panel__tags">
      {tags.map((tag) => (
        <li key={tag}>
          <Badge>{tag}</Badge>
        </li>
      ))}
    </ul>
  )
}

/** What was decided, where it stands, and the one way back to the chooser. */
function RecordedDecision({ decision }: Readonly<{ decision: RecordedDecisionView }>) {
  return (
    <div className="handling-panel__recorded">
      <p className="handling-panel__decision">
        <strong className="handling-panel__decision-title">{decision.title}</strong>
        <Badge tone={decision.state.tone}>{decision.state.label}</Badge>
      </p>
      <p className="handling-panel__decision-detail">{decision.detail}</p>
      <Button
        className="handling-panel__change"
        variant="quiet"
        disabled={decision.changeDisabled ?? false}
        onClick={decision.onChange}
      >
        {decision.changeLabel}
      </Button>
    </div>
  )
}
