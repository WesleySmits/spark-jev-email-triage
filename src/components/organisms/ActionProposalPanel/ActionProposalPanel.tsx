import { useId, type ComponentProps } from 'react'
import { Badge } from '../../atoms/Badge/Badge'
import { Button } from '../../atoms/Button/Button'
import './ActionProposalPanel.css'

type HeadingLevel = 2 | 3 | 4

type BadgeTone = ComponentProps<typeof Badge>['tone']

/** A state, always as visible words: colour alone never carries one. */
type StateView = Readonly<{ label: string; tone: BadgeTone }>

/** One of the three stages, in the order they happen. */
export type ActionStage = Readonly<{
  id: string
  /** What the stage is, e.g. "Approval". */
  name: string
  state: StateView
  /** One line on what that state means here. */
  detail: string
}>

/** One observed mailbox copy from which a Spark message ID was selected. */
export type ActionTargetView = Readonly<{
  id: string
  /** How this workbench names the mailbox, for a reader, e.g. "Studio Noord". */
  label: string
  /**
   * The selected row's mailbox and message id. Spark's action command gets
   * only the message id; the mailbox is context for the person and preflight.
   */
  identity: string
  /** The version it was proposed against, and where that copy stands now. */
  detail: string
}>

/** One named precondition, and whether it is met. */
export type PreconditionView = Readonly<{ id: string; label: string; state: StateView }>

export type PanelAction = Readonly<{
  id: string
  label: string
  variant?: ComponentProps<typeof Button>['variant'] | undefined
  disabled?: boolean | undefined
  onClick: () => void
}>

type ActionProposalPanelProps = Readonly<{
  /** Level of the panel heading. The section headings sit one below. Defaults to 2. */
  headingLevel?: HeadingLevel | undefined
  /** Names the panel, e.g. "Mailbox action". */
  title: string
  /** One line under the title. */
  summary: string
  /** Proposal, approval and execution, in that order. All three always show. */
  stages: readonly ActionStage[]
  targetsTitle: string
  /**
   * Every selected row the proposal names. Empty until something is proposed.
   */
  targets: readonly ActionTargetView[]
  /** One line under the targets, e.g. what is deliberately not included. */
  targetsNote: string
  /** Shown in place of the list while nothing is proposed. */
  targetsEmpty: string
  /**
   * What the action would ask Spark to do and the scope limits of an ID-only
   * command. The caller must state that other copies may change.
   */
  effect: Readonly<{ title: string; statement: string; note: string }>
  preconditionsTitle: string
  preconditions: readonly PreconditionView[]
  /** The buttons this stage offers, e.g. Propose and Approve. */
  actions: readonly PanelAction[]
  /** Result copy beside the buttons. Not a live region: announce it yourself. */
  result: Readonly<{ title: string; detail: string }>
  className?: string | undefined
}>

const subheadings = { 2: 'h3', 3: 'h4', 4: 'h5' } as const

/**
 * One proposed mailbox action, as three stages a reader can tell apart:
 * what is proposed, what a person approved, and where execution stands. It
 * lists the selected rows, the Spark message IDs, the intended effect and
 * the ID-only scope limits, plus every precondition by name.
 *
 * Presentational only. The caller owns every string, every state and every
 * button; nothing here proposes, approves, reads a mailbox or runs an
 * action, and the panel adds no copy of its own. It names copies and
 * preconditions, never a subject, an address or a body. Below 560px of
 * container width it stacks.
 *
 * @example
 * import { ActionProposalPanel } from '../components/organisms/ActionProposalPanel/ActionProposalPanel'
 *
 * <ActionProposalPanel
 *   title="Mailbox action"
 *   summary="Spark Done uses the selected message ID."
 *   stages={[
 *     { id: 'proposal', name: 'Proposal', state: { label: 'Proposed', tone: 'review' }, detail: 'Mark message ID 11 as Done.' },
 *     { id: 'approval', name: 'Approval', state: { label: 'Waiting for you', tone: 'review' }, detail: 'A person approves this proposal.' },
 *     { id: 'execution', name: 'Execution', state: { label: 'Waiting', tone: 'review' }, detail: 'A separate confirmation starts the guarded action.' },
 *   ]}
 *   targetsTitle="Mailbox copies named"
 *   targets={[{ id: 'c1', label: 'Studio Noord', identity: 'studio@mail.example · message 11', detail: 'Thread t-11, latest message 11.' }]}
 *   targetsNote="Spark receives only the message ID; other copies may change."
 *   targetsEmpty="Nothing is proposed, so no copy is named."
 *   effect={{ title: 'What it would change', statement: 'Spark Done moves the message out of Inbox into Archive.', note: 'A new message may arrive between check and action.' }}
 *   preconditionsTitle="Before anything could run"
 *   preconditions={[{ id: 'p1', label: 'A person approved it', state: { label: 'Not met', tone: 'neutral' } }]}
 *   actions={[{ id: 'approve', label: 'Approve', onClick: approve }]}
 *   result={{ title: 'Not approved', detail: 'Your mailbox is unchanged.' }}
 * />
 */
export function ActionProposalPanel({
  headingLevel = 2,
  title,
  summary,
  stages,
  targetsTitle,
  targets,
  targetsNote,
  targetsEmpty,
  effect,
  preconditionsTitle,
  preconditions,
  actions,
  result,
  className,
}: ActionProposalPanelProps) {
  const id = useId()
  const titleId = `${id}-title`
  const Heading = `h${String(headingLevel)}` as `h${HeadingLevel}`
  const Subheading = subheadings[headingLevel]
  const classes = ['action-proposal-panel', className].filter(Boolean).join(' ')
  return (
    <section className={classes} aria-labelledby={titleId}>
      <div className="action-proposal-panel__head">
        <Heading id={titleId} className="action-proposal-panel__title">
          {title}
        </Heading>
        <p className="action-proposal-panel__summary">{summary}</p>
      </div>
      <ol className="action-proposal-panel__stages">
        {stages.map((stage) => (
          <li key={stage.id} className="action-proposal-panel__stage">
            <p className="action-proposal-panel__stage-name">{stage.name}</p>
            <Badge tone={stage.state.tone}>{stage.state.label}</Badge>
            <p className="action-proposal-panel__stage-detail">{stage.detail}</p>
          </li>
        ))}
      </ol>
      <div className="action-proposal-panel__section">
        <Subheading className="action-proposal-panel__subheading">{targetsTitle}</Subheading>
        {targets.length === 0 ? (
          <p className="action-proposal-panel__empty">{targetsEmpty}</p>
        ) : (
          <ul className="action-proposal-panel__targets">
            {targets.map((target) => (
              <li key={target.id} className="action-proposal-panel__target">
                <span className="action-proposal-panel__target-label">{target.label}</span>
                <span className="action-proposal-panel__target-identity">{target.identity}</span>
                <span className="action-proposal-panel__target-detail">{target.detail}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="action-proposal-panel__note">{targetsNote}</p>
      </div>
      <div className="action-proposal-panel__section">
        <Subheading className="action-proposal-panel__subheading">{effect.title}</Subheading>
        <p className="action-proposal-panel__effect">{effect.statement}</p>
        <p className="action-proposal-panel__note">{effect.note}</p>
      </div>
      <div className="action-proposal-panel__section">
        <Subheading className="action-proposal-panel__subheading">{preconditionsTitle}</Subheading>
        <ul className="action-proposal-panel__preconditions">
          {preconditions.map((precondition) => (
            <li key={precondition.id} className="action-proposal-panel__precondition">
              <span>{precondition.label}</span>
              <Badge tone={precondition.state.tone}>{precondition.state.label}</Badge>
            </li>
          ))}
        </ul>
      </div>
      <div className="action-proposal-panel__actions">
        {actions.map((action) => (
          <Button
            key={action.id}
            variant={action.variant ?? 'secondary'}
            disabled={action.disabled ?? false}
            onClick={action.onClick}
          >
            {action.label}
          </Button>
        ))}
        <p className="action-proposal-panel__result">
          <strong>{result.title}</strong>
          <span>{result.detail}</span>
        </p>
      </div>
    </section>
  )
}
