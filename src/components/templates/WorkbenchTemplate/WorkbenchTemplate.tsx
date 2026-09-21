import type { ReactNode } from 'react'
import './WorkbenchTemplate.css'

type WorkbenchTemplateProps = Readonly<{
  /** The bar above the workspace, usually a TopBar. */
  topBar: ReactNode
  /** The navigation rail, usually a Sidebar. Hidden below a 601px viewport. */
  sidebar: ReactNode
  /** The queue pane, usually a MessageQueue. Hidden below a 601px viewport. */
  queue: ReactNode
  /**
   * The reader pane, usually a MessageReader with a `mobileBar`, or an empty
   * or disconnected state when no message is open. The only pane below a
   * 601px viewport.
   */
  reader: ReactNode
  className?: string | undefined
}>

/**
 * The Compact workbench page layout: a top bar above a three-pane workspace
 * with the navigation rail, a bounded queue and a flexible reader. At 600px
 * and below it shows the mobile reader layout, the top bar above the reader
 * alone, instead of squeezing the columns.
 *
 * Layout only. The caller renders every slot and owns filtering, routing,
 * data, selection, keyboard shortcuts and mailbox actions. The template fills
 * the height its container gives it, so give it a bounded parent such as a
 * `100dvh` root; each pane then scrolls on its own and the page does not. It
 * wraps the queue and reader in `main`, after the rail, so the top bar stays
 * the banner landmark and Tab runs bar, rail, queue, reader.
 *
 * @example
 * import { WorkbenchTemplate } from '../components/templates/WorkbenchTemplate/WorkbenchTemplate'
 *
 * <WorkbenchTemplate
 *   topBar={<TopBar {...topBar} />}
 *   sidebar={<Sidebar {...sidebar} />}
 *   queue={<MessageQueue {...queue} />}
 *   reader={
 *     message ? (
 *       <MessageReader key={message.id} {...reader} mobileBar={{ title, onBack: showList }}>
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
  className,
}: WorkbenchTemplateProps) {
  const classes = ['workbench', className].filter(Boolean).join(' ')
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
