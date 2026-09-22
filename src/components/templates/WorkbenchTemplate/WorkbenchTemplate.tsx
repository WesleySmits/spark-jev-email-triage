import type { ReactNode } from 'react'
import './WorkbenchTemplate.css'

type WorkbenchTemplateProps = Readonly<{
  /** The bar above the workspace, usually a TopBar. */
  topBar: ReactNode
  /** The navigation rail, usually a Sidebar. Hidden at 600px and below. */
  sidebar: ReactNode
  /**
   * The queue pane, usually a MessageQueue. At 600px and below it shows when
   * `mobilePane` is "queue".
   */
  queue: ReactNode
  /**
   * The reader pane, usually a MessageReader with a `mobileBar`, or an empty
   * or disconnected state when no message is open. At 600px and below it
   * shows when `mobilePane` is "reader".
   */
  reader: ReactNode
  /**
   * The one pane shown at 600px and below, under the top bar. The caller owns
   * this state, e.g. "queue" until a message opens and again after the mobile
   * bar's back button. It has no effect on wider screens. Defaults to "reader".
   * The pane that hides takes focus with it, so on a switch the caller moves
   * focus into the pane that shows, e.g. the opened row after going back.
   */
  mobilePane?: 'queue' | 'reader' | undefined
  className?: string | undefined
}>

/**
 * The Compact workbench page layout: a top bar above a three-pane workspace
 * with the navigation rail, a bounded queue and a flexible reader. At 600px
 * and below it shows the top bar above one pane, the queue or the reader as
 * `mobilePane` says, instead of squeezing the columns.
 *
 * Layout only. The caller renders every slot and owns filtering, routing,
 * data, selection, keyboard shortcuts, mailbox actions and which pane shows
 * on mobile. The template fills the height its container gives it, so give it
 * a bounded parent such as a `100dvh` root; each pane then scrolls on its own
 * and the page does not. It wraps the queue and reader in `main`, after the
 * rail, so the top bar stays the banner landmark and Tab runs bar, rail,
 * queue, reader.
 *
 * @example
 * import { WorkbenchTemplate } from '../components/templates/WorkbenchTemplate/WorkbenchTemplate'
 *
 * <WorkbenchTemplate
 *   mobilePane={message ? 'reader' : 'queue'}
 *   topBar={<TopBar {...topBar} />}
 *   sidebar={<Sidebar {...sidebar} />}
 *   queue={<MessageQueue {...queue} />}
 *   reader={
 *     message ? (
 *       <MessageReader key={message.id} {...reader} mobileBar={{ title, onBack: closeMessage }}>
 *         {paragraphs}
 *       </MessageReader>
 *     ) : (
 *       <EmptyState title="No message open" description="Choose a message in the list." />
 *     )
 *   }
 * />
 */
export function WorkbenchTemplate({
  topBar,
  sidebar,
  queue,
  reader,
  mobilePane = 'reader',
  className,
}: WorkbenchTemplateProps) {
  const classes = ['workbench', `workbench--mobile-${mobilePane}`, className]
    .filter(Boolean)
    .join(' ')
  return (
    <div className={classes}>
      {topBar}
      <div className="workbench__workspace">
        <div className="workbench__sidebar">{sidebar}</div>
        <main className="workbench__main">
          <div className="workbench__queue">{queue}</div>
          <div className="workbench__reader">{reader}</div>
        </main>
      </div>
    </div>
  )
}
