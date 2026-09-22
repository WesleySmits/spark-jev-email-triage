import { useId, type ComponentProps, type ReactNode } from 'react'
import { MobileReaderBar } from '../../molecules/MobileReaderBar/MobileReaderBar'
import { ReaderActionBar } from '../../molecules/ReaderActionBar/ReaderActionBar'
import { ReaderHeader } from '../../molecules/ReaderHeader/ReaderHeader'
import './MessageReader.css'

type MessageReaderProps = Readonly<{
  /** The contextual bar above the header. It only shows below a 600px viewport. Leave it out to show none. */
  mobileBar?: Omit<ComponentProps<typeof MobileReaderBar>, 'className'> | undefined
  /** Subject, status and sender. See ReaderHeader. The reader sets the heading id and is named by it. */
  header: Omit<ComponentProps<typeof ReaderHeader>, 'subjectId' | 'className'>
  /**
   * The message body as plain React nodes, e.g. one `<p>` per paragraph. The
   * caller turns the mail into safe text first, usually with
   * formatMessageBody; the reader never renders HTML.
   */
  children: ReactNode
  /** Accessible name of the scrollable content region. Defaults to "Message content". */
  contentLabel?: string | undefined
  /** Shown under the body in the same scroll, e.g. a ReviewPanel the caller controls. */
  review?: ReactNode
  /** The footer actions and note. See ReaderActionBar. Leave it out to show no footer. */
  actions?: Omit<ComponentProps<typeof ReaderActionBar>, 'className'> | undefined
  className?: string | undefined
}>

/**
 * The message reader: on mobile a contextual bar, then the header, one
 * scrollable region with the body and an optional review, and the action
 * footer, from the source's `.reader`.
 *
 * Presentational only. The caller owns the message, every string, the review
 * panel's state, every action and any announcement; the reader fetches
 * nothing, handles no keys and changes no mail. It fills the height its
 * container gives it and only the content region scrolls, so the header and
 * footer stay in place. Give it a new `key` per message to reset the scroll.
 * The body is rendered as given, as text and elements, never as raw HTML, and
 * long words wrap instead of scrolling sideways.
 *
 * @example
 * import { MessageReader } from '../components/organisms/MessageReader/MessageReader'
 *
 * <MessageReader
 *   key={message.id}
 *   mobileBar={{ title: 'Studio Noord', context: '1 of 3 in Needs review', onBack: showList }}
 *   header={{ subject: message.subject, sender: message.sender }}
 *   review={<ReviewPanel {...review} />}
 *   actions={{ primaryAction: { label: 'Archive', shortcut: 'E', onClick: archive } }}
 * >
 *   {message.paragraphs.map((text, index) => <p key={index}>{text}</p>)}
 * </MessageReader>
 */
export function MessageReader({
  mobileBar,
  header,
  children,
  contentLabel = 'Message content',
  review,
  actions,
  className,
}: MessageReaderProps) {
  const subjectId = `${useId()}-subject`
  const classes = ['message-reader', className].filter(Boolean).join(' ')
  return (
    <article className={classes} aria-labelledby={subjectId}>
      {mobileBar && <MobileReaderBar {...mobileBar} className="message-reader__mobile-bar" />}
      <ReaderHeader {...header} subjectId={subjectId} />
      {/* Focusable so keyboard users can scroll it; named so focus announces it. */}
      <div className="message-reader__scroll" role="region" aria-label={contentLabel} tabIndex={0}>
        <div className="message-reader__body">{children}</div>
        {review && <div className="message-reader__review">{review}</div>}
      </div>
      {actions && <ReaderActionBar {...actions} />}
    </article>
  )
}
