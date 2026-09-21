import type { ComponentProps } from 'react'
import { AccountMarker } from '../../atoms/AccountMarker/AccountMarker'
import { Avatar } from '../../atoms/Avatar/Avatar'
import './SenderMeta.css'

type SenderMetaProps = Readonly<{
  /** The sender's display name, as the caller wants it shown. */
  name: string
  /** One or two letters for the avatar, for example `MV`. */
  initials: string
  /** The sender's address, already chosen by the caller. Leave it out to show only the mailbox. */
  address?: string | undefined
  /** The mailbox the message arrived in: its marker color and its always visible name. */
  account: Readonly<{ marker: ComponentProps<typeof AccountMarker>['account']; label: string }>
  /**
   * Hidden text between the address and the mailbox, read instead of the
   * visible arrow. Defaults to "to".
   */
  toLabel?: string | undefined
  /** Visible time, already formatted, for example "Today, 09:42". */
  time: string
  /** Machine-readable form of `time` for the `<time>` element. */
  dateTime?: string | undefined
  className?: string | undefined
}>

/**
 * Who sent the open message, which mailbox received it, and when: the sender
 * row under the reader's subject.
 *
 * Presentational only. The caller formats every string; nothing is parsed.
 * The avatar and the account marker are decorative, because the name and the
 * mailbox are always visible. Long names and addresses wrap instead of
 * widening the reader, and in a narrow column the time moves under the text.
 *
 * @example
 * import { SenderMeta } from '../components/molecules/SenderMeta/SenderMeta'
 *
 * <SenderMeta
 *   name="Marit Vos"
 *   initials="MV"
 *   address="marit.vos@example.com"
 *   account={{ marker: 'studio', label: 'Studio Noord' }}
 *   time="Today, 09:42"
 *   dateTime="2026-09-21T09:42"
 * />
 */
export function SenderMeta({
  name,
  initials,
  address,
  account,
  toLabel = 'to',
  time,
  dateTime,
  className,
}: SenderMetaProps) {
  const classes = ['sender-meta', className].filter(Boolean).join(' ')
  return (
    <div className={classes}>
      <Avatar initials={initials} />
      <div className="sender-meta__body">
        <div className="sender-meta__copy">
          <span className="sender-meta__name">{name}</span>
          <span className="sender-meta__context">
            {address && (
              <>
                <span className="sender-meta__address">{address}</span> <span aria-hidden>→</span>
                <span className="sender-meta__hidden">{toLabel}</span>{' '}
              </>
            )}
            <span className="sender-meta__account">
              <AccountMarker account={account.marker} />
              {account.label}
            </span>
          </span>
        </div>
        <time className="sender-meta__time" dateTime={dateTime}>
          {time}
        </time>
      </div>
    </div>
  )
}
