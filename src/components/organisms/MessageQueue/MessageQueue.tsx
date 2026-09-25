import { useId, type ComponentProps, type ReactNode } from 'react'
import { BulkActionBar } from '../../molecules/BulkActionBar/BulkActionBar'
import { MessageRow } from '../../molecules/MessageRow/MessageRow'
import { QueueHeader } from '../../molecules/QueueHeader/QueueHeader'
import './MessageQueue.css'

/** One message in the queue: a MessageRow's content plus a stable id, used as its key. */
export type QueueMessage = Omit<
  ComponentProps<typeof MessageRow>,
  'selected' | 'onActivate' | 'selection' | 'className'
> &
  Readonly<{ id: string }>

type QueueSelection = Readonly<{
  /** Ids of the checked rows. The caller owns this set. */
  selectedIds: ReadonlySet<string>
  /** Accessible name of a row's checkbox, e.g. `Select ${message.subject}`. */
  label: (message: QueueMessage) => string
  /** Called with the row's id and its new state. The row is not opened. */
  onChange: (id: string, checked: boolean) => void
}>

/** One titled group of rows, e.g. "Needs review · 2 of 10 loaded". */
type QueueGroup = Readonly<{
  id: string
  title: string
  /** The count beside the title, and how far it reaches. */
  note?: string | undefined
  /** The group's rows, in the caller's order. May be empty: the title still shows. */
  messages: readonly QueueMessage[]
}>

type MessageQueueProps = Readonly<{
  /** Title, count, scope and optional action. The title also names the region. */
  header: Omit<ComponentProps<typeof QueueHeader>, 'titleId' | 'className'>
  /** An optional bar between the header and the list. The caller owns its state. */
  bulkActions?: ComponentProps<typeof BulkActionBar> | undefined
  /** The rows, in the caller's order. Nothing here sorts or filters them. */
  messages: readonly QueueMessage[]
  /**
   * The same rows as titled groups, in the caller's order, each a labelled
   * section with its own list. Given, the groups are what is rendered and
   * `messages` decides only whether the queue is empty; every group is
   * shown, an empty one as its title alone, so a tally reads complete.
   */
  groups?: readonly QueueGroup[] | undefined
  /** Id of the message open in the reader. That row gets the selection look and `aria-current`. */
  currentId?: string | null | undefined
  /** Called with the row's id when it is clicked or activated with Enter or Space. */
  onOpen: (id: string) => void
  /** Adds a checkbox to every row for bulk selection. */
  selection?: QueueSelection | undefined
  /** Shown instead of the list when `messages` is empty, e.g. an empty state. */
  empty?: ReactNode
  className?: string | undefined
}>

/**
 * The queue column: a header, an optional bulk action bar and a scrolling list
 * of message rows, in one region named by the header's title.
 *
 * Presentational only. The caller passes the rows in display order and owns
 * which row is open, which rows are checked, and every callback. The queue
 * fills its container's height and only the list scrolls, so give it a
 * bounded parent. Checking a row (bulk selection) and opening it (current)
 * stay separate, as in MessageRow.
 *
 * @example
 * import { MessageQueue } from '../components/organisms/MessageQueue/MessageQueue'
 *
 * <MessageQueue
 *   header={{ title: 'Needs review', count: '3 results', context: 'All accounts · current filter' }}
 *   messages={messages}
 *   currentId={openId}
 *   onOpen={setOpenId}
 *   selection={{ selectedIds, label: (m) => `Select ${m.subject}`, onChange: toggle }}
 *   empty={<p>No results in this filter.</p>}
 * />
 */
export function MessageQueue({
  header,
  bulkActions,
  messages,
  groups,
  currentId,
  onOpen,
  selection,
  empty,
  className,
}: MessageQueueProps) {
  const titleId = useId()
  const classes = ['message-queue', className].filter(Boolean).join(' ')
  return (
    <section className={classes} aria-labelledby={titleId}>
      <QueueHeader {...header} titleId={titleId} />
      {bulkActions && <BulkActionBar {...bulkActions} />}
      <div className="message-queue__body">
        {messages.length === 0 ? (
          empty
        ) : groups ? (
          <ul role="list" className="message-queue__list message-queue__list--grouped">
            {groups.map((group) => (
              <li key={group.id} className="message-queue__group">
                <QueueGroupSection
                  group={group}
                  headingLevel={groupHeadingLevel(header.headingLevel)}
                  currentId={currentId}
                  onOpen={onOpen}
                  selection={selection}
                />
              </li>
            ))}
          </ul>
        ) : (
          <QueueList
            messages={messages}
            currentId={currentId}
            onOpen={onOpen}
            selection={selection}
          />
        )}
      </div>
    </section>
  )
}

type QueueListProps = Readonly<{
  messages: readonly QueueMessage[]
  currentId: string | null | undefined
  onOpen: (id: string) => void
  selection: QueueSelection | undefined
}>

/** The rows as one list. Safari drops list semantics from unstyled lists; the role restores them. */
function QueueList({ messages, currentId, onOpen, selection }: QueueListProps) {
  return (
    <ul role="list" className="message-queue__list">
      {messages.map((message) => (
        <li key={message.id}>
          <QueueRow
            message={message}
            current={message.id === currentId}
            onOpen={onOpen}
            selection={selection}
          />
        </li>
      ))}
    </ul>
  )
}

type HeadingLevel = NonNullable<ComponentProps<typeof QueueHeader>['headingLevel']>

/** One level under the queue title, which names the whole region. */
const groupHeadingLevel = (title: HeadingLevel = 2): 2 | 3 | 4 =>
  title === 1 ? 2 : title === 2 ? 3 : 4

type QueueGroupSectionProps = Omit<QueueListProps, 'messages'> &
  Readonly<{ group: QueueGroup; headingLevel: 2 | 3 | 4 }>

/** One group: a heading with its count, and the group's own list under it. */
function QueueGroupSection({ group, headingLevel, ...list }: QueueGroupSectionProps) {
  const id = useId()
  const Heading = `h${String(headingLevel)}` as 'h2' | 'h3' | 'h4'
  return (
    <section aria-labelledby={id}>
      <Heading id={id} className="message-queue__group-title">
        <span className="message-queue__group-name">{group.title}</span>
        {group.note !== undefined && (
          <span className="message-queue__group-note">{group.note}</span>
        )}
      </Heading>
      {group.messages.length > 0 && <QueueList messages={group.messages} {...list} />}
    </section>
  )
}

type QueueRowProps = Readonly<{
  message: QueueMessage
  current: boolean
  onOpen: (id: string) => void
  selection: QueueSelection | undefined
}>

/** Binds one message to its MessageRow with the caller's callbacks. */
function QueueRow({ message, current, onOpen, selection }: QueueRowProps) {
  const { id, ...content } = message
  return (
    <MessageRow
      {...content}
      selected={current}
      onActivate={() => {
        onOpen(id)
      }}
      selection={
        selection && {
          label: selection.label(message),
          checked: selection.selectedIds.has(id),
          onChange: (checked) => {
            selection.onChange(id, checked)
          },
        }
      }
    />
  )
}
