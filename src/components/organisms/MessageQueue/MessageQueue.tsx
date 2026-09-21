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

type MessageQueueProps = Readonly<{
  /** Title, count, scope and optional action. The title also names the region. */
  header: Omit<ComponentProps<typeof QueueHeader>, 'titleId' | 'className'>
  /** An optional bar between the header and the list. The caller owns its state. */
  bulkActions?: ComponentProps<typeof BulkActionBar> | undefined
  /** The rows, in the caller's order. Nothing here sorts or filters them. */
  messages: readonly QueueMessage[]
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
        {messages.length > 0 ? (
          // Safari drops list semantics from unstyled lists; the role restores them.
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
        ) : (
          empty
        )}
      </div>
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
