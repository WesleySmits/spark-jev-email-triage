import { useId, type ComponentProps } from 'react'
import { Badge } from '../../atoms/Badge/Badge'
import { Button } from '../../atoms/Button/Button'
import { EmptyState } from '../../molecules/EmptyState/EmptyState'
import { QueueHeader } from '../../molecules/QueueHeader/QueueHeader'
import './OpenWorkPanel.css'

type Tone = ComponentProps<typeof Badge>['tone']

/** One mailbox copy's saved work, already in words. */
export type OpenWorkItemView = Readonly<{
  /** Stable per mailbox copy, so two copies of one delivery stay two items. */
  id: string
  /** What the item is about, e.g. the listed subject. */
  title: string
  /** The mailbox this copy is in, as the rail names it. */
  source: string
  /** What was decided, e.g. "Reply needed". */
  decision: Readonly<{ label: string; tone: Tone }>
  /** Where that work stands now, e.g. "Overdue". */
  standing: Readonly<{ label: string; tone: Tone }>
  /** Who saved the latest decision and when, e.g. "Saved by you on 26 Sep". */
  saved: string
  /** Where the copy stands in the source mailbox, as evidence allows. */
  inbox: string
  /** Every disagreement between the record and the mailbox, in words. */
  conflicts: readonly string[]
  /** Offered where the item can be opened in the reader. */
  rowId?: string | undefined
  /** Offered where a closure may be reopened. */
  reopen?: unknown
}>

/** One titled group of items, e.g. "Overdue follow-up". */
export type OpenWorkSectionView = Readonly<{
  id: string
  title: string
  /** The count beside the title, already formatted. */
  count: string
  items: readonly OpenWorkItemView[]
}>

type OpenWorkPanelProps = Readonly<{
  /** Title, counts and where they come from. The title also names the region. */
  header: Readonly<{
    title: string
    count: string
    context: string
    /** What may be missing from the list, where anything may be. */
    note?: string | undefined
  }>
  sections: readonly OpenWorkSectionView[]
  /** Shown above the sections when nothing is owed. Left out: nothing is shown. */
  empty?: Readonly<{ title: string; description: string }> | null | undefined
  onOpen: (rowId: string) => void
  onReopen: (id: string) => void
  /** The item whose reopen is being saved, whose button is disabled meanwhile. */
  busyId?: string | undefined
  /** Announced politely, e.g. what became of the last reopen. */
  status?: string | undefined
  className?: string | undefined
}>

/**
 * The list of work saved in this app, beside the Inbox rather than inside
 * it: each mailbox copy's latest decision, where that work stands, where the
 * copy stands in the mailbox, and every disagreement between the two, in
 * words. Overdue, open, unchecked and completed work sit in their own
 * labelled sections.
 *
 * Presentational and controlled. The caller owns every string, the order of
 * sections and items, and what opening and reopening do; nothing here reads
 * a store, records a decision or touches a mailbox. Colour never carries a
 * state alone: every badge has its text, and conflicts are sentences.
 *
 * @example
 * import { OpenWorkPanel } from '../components/organisms/OpenWorkPanel/OpenWorkPanel'
 *
 * <OpenWorkPanel
 *   header={{ title: 'Open work', count: '2 open · 1 overdue', context: 'Saved in this app' }}
 *   sections={sections}
 *   onOpen={openRow}
 *   onReopen={reopen}
 * />
 */
export function OpenWorkPanel({
  header,
  sections,
  empty,
  onOpen,
  onReopen,
  busyId,
  status,
  className,
}: OpenWorkPanelProps) {
  const titleId = useId()
  const classes = ['open-work', className].filter(Boolean).join(' ')
  return (
    <section className={classes} aria-labelledby={titleId}>
      <QueueHeader
        title={header.title}
        titleId={titleId}
        headingLevel={1}
        count={header.count}
        context={header.context}
        controls={header.note && <p className="open-work__note">{header.note}</p>}
      />
      <div className="open-work__body">
        {empty && (
          <EmptyState
            icon="inbox"
            headingLevel={2}
            title={empty.title}
            description={empty.description}
          />
        )}
        {sections.map((section) => (
          <Section
            key={section.id}
            section={section}
            onOpen={onOpen}
            onReopen={onReopen}
            busyId={busyId}
          />
        ))}
      </div>
      <p className="open-work__status" role="status">
        {status}
      </p>
    </section>
  )
}

type SectionProps = Readonly<{
  section: OpenWorkSectionView
  onOpen: (rowId: string) => void
  onReopen: (id: string) => void
  busyId: string | undefined
}>

function Section({ section, onOpen, onReopen, busyId }: SectionProps) {
  const id = useId()
  return (
    <section className="open-work__section" aria-labelledby={id}>
      <h2 className="open-work__section-title" id={id}>
        {section.title}
        <span className="open-work__section-count">{section.count}</span>
      </h2>
      <ul className="open-work__list">
        {section.items.map((item) => (
          <Item
            key={item.id}
            item={item}
            onOpen={onOpen}
            onReopen={onReopen}
            busy={busyId === item.id}
          />
        ))}
      </ul>
    </section>
  )
}

type ItemProps = Readonly<{
  item: OpenWorkItemView
  onOpen: (rowId: string) => void
  onReopen: (id: string) => void
  busy: boolean
}>

function Item({ item, onOpen, onReopen, busy }: ItemProps) {
  const titleId = useId()
  const { rowId } = item
  return (
    <li className="open-work__item">
      <article aria-labelledby={titleId}>
        <h3 className="open-work__title" id={titleId}>
          {item.title}
        </h3>
        <p className="open-work__source">Mailbox: {item.source}</p>
        <p className="open-work__badges">
          <Badge tone={item.decision.tone}>{item.decision.label}</Badge>
          <Badge tone={item.standing.tone}>{item.standing.label}</Badge>
        </p>
        <p className="open-work__meta">{item.saved}</p>
        <p className="open-work__meta">{item.inbox}</p>
        {item.conflicts.length > 0 && (
          <ul className="open-work__conflicts" aria-label="Conflicts">
            {item.conflicts.map((conflict) => (
              <li key={conflict}>{conflict}</li>
            ))}
          </ul>
        )}
        {(rowId !== undefined || item.reopen !== undefined) && (
          <div className="open-work__actions">
            {rowId !== undefined && (
              <Button
                variant="secondary"
                aria-describedby={titleId}
                onClick={() => {
                  onOpen(rowId)
                }}
              >
                Open in reader
              </Button>
            )}
            {item.reopen !== undefined && (
              <Button
                variant="quiet"
                aria-describedby={titleId}
                disabled={busy}
                onClick={() => {
                  onReopen(item.id)
                }}
              >
                {busy ? 'Reopening…' : 'Reopen work'}
              </Button>
            )}
          </div>
        )}
      </article>
    </li>
  )
}
