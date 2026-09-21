import type { ComponentProps } from 'react'
import { Badge } from '../../atoms/Badge/Badge'
import { SenderMeta } from '../SenderMeta/SenderMeta'
import './ReaderHeader.css'

type ReaderHeaderProps = Readonly<{
  /** The open message's subject, as the caller wants it shown. */
  subject: string
  /** Level of the subject heading, to fit the caller's page outline. Defaults to 2. */
  headingLevel?: 1 | 2 | 3 | 4 | undefined
  /** Id for the heading, so the caller can name its reader with `aria-labelledby`. */
  subjectId?: string | undefined
  /** The message's state beside the subject. Its label is always visible. Leave it out to show none. */
  status?: Readonly<{ tone: ComponentProps<typeof Badge>['tone']; label: string }> | undefined
  /** Who sent the message, which mailbox received it, and when. See SenderMeta. */
  sender: Omit<ComponentProps<typeof SenderMeta>, 'className'>
  className?: string | undefined
}>

/**
 * The top of the reader: the subject as a heading, an optional status badge,
 * and the sender row under them.
 *
 * Presentational only. The caller formats every string and picks the heading
 * level; the header fetches nothing and has no actions. The badge sits outside
 * the heading, so the heading's name is the subject alone. In a narrow reader
 * the badge moves under the subject, and long text wraps instead of widening
 * the reader.
 *
 * @example
 * import { ReaderHeader } from '../components/molecules/ReaderHeader/ReaderHeader'
 *
 * <article aria-labelledby="reader-subject">
 *   <ReaderHeader
 *     subject="Can delivery move a week earlier?"
 *     subjectId="reader-subject"
 *     status={{ tone: 'review', label: 'Needs review' }}
 *     sender={{
 *       name: 'Marit Vos',
 *       initials: 'MV',
 *       address: 'marit.vos@example.com',
 *       account: { marker: 'studio', label: 'Studio Noord' },
 *       time: 'Today, 09:42',
 *       dateTime: '2026-09-21T09:42',
 *     }}
 *   />
 *   …
 * </article>
 */
export function ReaderHeader({
  subject,
  headingLevel = 2,
  subjectId,
  status,
  sender,
  className,
}: ReaderHeaderProps) {
  const Heading = `h${String(headingLevel)}` as `h${NonNullable<typeof headingLevel>}`
  const classes = ['reader-header', className].filter(Boolean).join(' ')
  return (
    <div className={classes}>
      <div className="reader-header__title-row">
        <Heading id={subjectId} className="reader-header__subject">
          {subject}
        </Heading>
        {status && (
          <span className="reader-header__status">
            <Badge tone={status.tone}>{status.label}</Badge>
          </span>
        )}
      </div>
      <SenderMeta {...sender} className="reader-header__sender" />
    </div>
  )
}
