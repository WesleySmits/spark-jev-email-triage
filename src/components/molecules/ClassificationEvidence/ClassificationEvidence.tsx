import { useId, type ComponentProps } from 'react'
import { Badge } from '../../atoms/Badge/Badge'
import './ClassificationEvidence.css'

type HeadingLevel = 2 | 3 | 4

/** One named value, e.g. Priority · High, with an optional aside under it. */
type EvidenceFact = Readonly<{
  /** What the value is, e.g. "Priority". */
  term: string
  value: string
  /** One short line qualifying the value. Leave it out to show none. */
  note?: string | undefined
}>

type ClassificationEvidenceProps = Readonly<{
  /** Names the panel, e.g. "Jev triage". Shown as a small overline heading. */
  title: string
  /** Level of that heading, to fit the caller's outline. Defaults to 3. */
  headingLevel?: HeadingLevel | undefined
  /** The state, always as visible words: color alone never carries it. */
  state: Readonly<{ label: string; tone: ComponentProps<typeof Badge>['tone'] }>
  /** One line saying what the state means for this message. */
  detail: string
  /** Category, priority and review need. Leave it out when none apply. */
  facts?: readonly EvidenceFact[] | undefined
  /** A short aside under the detail, e.g. the coarse reason a failure reported. */
  note?: string | undefined
  /** When it was judged: the caller's wording, and the machine-readable instant. */
  judged?: Readonly<{ label: string; text: string; dateTime?: string | undefined }> | undefined
  className?: string | undefined
}>

/**
 * What is known about one message's triage, shown beside the message itself:
 * the state as a labelled badge, one line on what that state means, the
 * labels that apply, and when it was judged.
 *
 * Presentational only. The caller owns every string, decides which state
 * applies and whether to show the panel at all; nothing here fetches,
 * classifies or changes anything, and it offers no action. It is a strip
 * divided by rules rather than a card, so it sits under a reader header
 * without nesting. Facts stack below 480px of container width.
 *
 * @example
 * import { ClassificationEvidence } from '../components/molecules/ClassificationEvidence/ClassificationEvidence'
 *
 * <ClassificationEvidence
 *   title="Jev triage"
 *   state={{ label: 'Triage current', tone: 'done' }}
 *   detail="Checked against the thread that was read for this message."
 *   facts={[
 *     { term: 'Category', value: 'Personal' },
 *     { term: 'Priority', value: 'High', note: 'The model was not sure of this priority.' },
 *   ]}
 *   judged={{ label: 'Judged', text: '22 Sep, 09:15', dateTime: '2026-09-22T09:15:00.000Z' }}
 * />
 */
export function ClassificationEvidence({
  title,
  headingLevel = 3,
  state,
  detail,
  facts = [],
  note,
  judged,
  className,
}: ClassificationEvidenceProps) {
  const titleId = `${useId()}-title`
  const Heading = `h${String(headingLevel)}` as `h${HeadingLevel}`
  const classes = ['classification-evidence', className].filter(Boolean).join(' ')
  return (
    <section className={classes} aria-labelledby={titleId}>
      <div className="classification-evidence__head">
        <Heading id={titleId} className="classification-evidence__title">
          {title}
        </Heading>
        <Badge tone={state.tone}>{state.label}</Badge>
      </div>
      <p className="classification-evidence__detail">{detail}</p>
      {note && <p className="classification-evidence__note">{note}</p>}
      {facts.length > 0 && (
        <dl className="classification-evidence__facts">
          {facts.map((fact) => (
            <div key={fact.term} className="classification-evidence__fact">
              <dt className="classification-evidence__term">{fact.term}</dt>
              <dd className="classification-evidence__value">
                {fact.value}
                {fact.note && (
                  <span className="classification-evidence__fact-note">{fact.note}</span>
                )}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {judged && (
        <p className="classification-evidence__judged">
          {judged.label}{' '}
          <time dateTime={judged.dateTime} className="classification-evidence__time">
            {judged.text}
          </time>
        </p>
      )}
    </section>
  )
}
