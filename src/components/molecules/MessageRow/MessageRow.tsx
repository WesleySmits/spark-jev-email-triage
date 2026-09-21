import { useId, type ComponentProps } from 'react'
import { AccountMarker } from '../../atoms/AccountMarker/AccountMarker'
import { Badge } from '../../atoms/Badge/Badge'
import { Checkbox } from '../../atoms/Checkbox/Checkbox'
import './MessageRow.css'

type MessageRowSelection = Readonly<{
  /** Accessible name of the hidden-label checkbox, for example "Select Invoice March". */
  label: string
  checked: boolean
  /** Called with the new state. The row itself is not activated. */
  onChange: (checked: boolean) => void
  disabled?: boolean | undefined
}>

type MessageRowProps = Readonly<{
  sender: string
  /** Visible time, already formatted, for example "09:42" or "Yesterday". */
  time: string
  /** Machine-readable form of `time` for the `<time>` element. */
  dateTime?: string | undefined
  subject: string
  snippet: string
  /** The mailbox account: its marker color and its always visible name. */
  account: Readonly<{ marker: ComponentProps<typeof AccountMarker>['account']; label: string }>
  /** The workflow status, always shown as a labelled badge. */
  status: Readonly<{ label: string; tone: NonNullable<ComponentProps<typeof Badge>['tone']> }>
  /** Optional category, shown as a neutral badge after the status. */
  category?: string | undefined
  /** Strengthens sender and subject and prefixes the name with `unreadLabel`. */
  unread?: boolean | undefined
  /** Hidden text announced for unread rows. Defaults to "Unread". */
  unreadLabel?: string | undefined
  /** The row open in the reader. Sets `aria-current` and the selection look. */
  selected?: boolean | undefined
  /** Called when the row is clicked or activated with Enter or Space. */
  onActivate: () => void
  /** Adds a bulk-selection checkbox, a sibling of the row button. */
  selection?: MessageRowSelection | undefined
  className?: string | undefined
}>

/**
 * One queue row: sender, time, subject, snippet, account, status and category.
 *
 * The row is a `<div>` holding two sibling controls, never nested: an optional
 * Checkbox for bulk selection and a `<button>` that opens the message. Each
 * has its own callback, so checking a row never opens it. The button's name is
 * the unread label, sender and subject; the rest is its description. Render
 * rows inside a list that the caller owns.
 *
 * @example
 * import { MessageRow } from '../components/molecules/MessageRow/MessageRow'
 *
 * <ul className="queue">
 *   <li>
 *     <MessageRow
 *       sender="Marit Vos"
 *       time="09:42"
 *       subject="Can delivery move a week earlier?"
 *       snippet="After our meeting I looked at the planning…"
 *       account={{ marker: 'studio', label: 'Studio Noord' }}
 *       status={{ label: 'Needs review', tone: 'review' }}
 *       unread
 *       selected={openId === 'm1'}
 *       onActivate={() => open('m1')}
 *       selection={{ label: 'Select Can delivery move a week earlier?', checked, onChange: setChecked }}
 *     />
 *   </li>
 * </ul>
 */
export function MessageRow({
  unread = false,
  unreadLabel = 'Unread',
  selected = false,
  onActivate,
  selection,
  className,
  ...content
}: MessageRowProps) {
  const id = useId()
  const ids = {
    unread: `${id}-unread`,
    sender: `${id}-sender`,
    time: `${id}-time`,
    subject: `${id}-subject`,
    snippet: `${id}-snippet`,
    account: `${id}-account`,
    tags: `${id}-tags`,
  }
  const classes = [
    'message-row',
    unread && 'message-row--unread',
    selected && 'message-row--selected',
    selection && 'message-row--selectable',
    className,
  ]
    .filter(Boolean)
    .join(' ')
  return (
    <div className={classes}>
      {selection && (
        <Checkbox
          className="message-row__check"
          label={selection.label}
          hideLabel
          checked={selection.checked}
          disabled={selection.disabled}
          onChange={(event) => {
            selection.onChange(event.currentTarget.checked)
          }}
        />
      )}
      <button
        className="message-row__button"
        type="button"
        aria-current={selected ? 'true' : undefined}
        aria-labelledby={[unread && ids.unread, ids.sender, ids.subject].filter(Boolean).join(' ')}
        aria-describedby={[ids.tags, ids.account, ids.time, ids.snippet].join(' ')}
        onClick={onActivate}
      >
        <MessageRowText {...content} ids={ids} unreadLabel={unread ? unreadLabel : undefined} />
      </button>
    </div>
  )
}

type MessageRowTextProps = Pick<
  MessageRowProps,
  'sender' | 'time' | 'dateTime' | 'subject' | 'snippet' | 'account' | 'status' | 'category'
> &
  Readonly<{
    ids: Readonly<
      Record<'unread' | 'sender' | 'time' | 'subject' | 'snippet' | 'account' | 'tags', string>
    >
    /** Set only for unread rows. */
    unreadLabel: string | undefined
  }>

/** The row's visible text, as phrasing content for the button. */
function MessageRowText({
  sender,
  time,
  dateTime,
  subject,
  snippet,
  account,
  status,
  category,
  ids,
  unreadLabel,
}: MessageRowTextProps) {
  return (
    <>
      <span className="message-row__top">
        {unreadLabel && (
          <span id={ids.unread} className="message-row__hidden">
            {unreadLabel}
          </span>
        )}
        <span id={ids.sender} className="message-row__sender message-row__truncate">
          {sender}
        </span>
        <time id={ids.time} className="message-row__time" dateTime={dateTime}>
          {time}
        </time>
      </span>
      <span id={ids.subject} className="message-row__subject message-row__truncate">
        {subject}
      </span>
      <span id={ids.snippet} className="message-row__snippet message-row__truncate">
        {snippet}
      </span>
      <span className="message-row__foot">
        <span id={ids.account} className="message-row__account">
          <AccountMarker account={account.marker} />
          <span className="message-row__truncate">{account.label}</span>
        </span>
        <span id={ids.tags} className="message-row__tags">
          <Badge tone={status.tone}>{status.label}</Badge>
          {category && <Badge>{category}</Badge>}
        </span>
      </span>
    </>
  )
}
