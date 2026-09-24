import type { ReactNode } from 'react'
import './WorkbenchTemplate.css'

/**
 * The widest viewport that hides the navigation rail, in CSS pixels.
 * `WorkbenchTemplate.css` matches it, and `WorkbenchTemplate.test.tsx` keeps
 * the two the same.
 */
export const compactWidth = 900

/**
 * Matches while the rail is hidden, for `window.matchMedia`. A caller that
 * shows something only in the compact layout, such as an open filter sheet,
 * uses it to stop showing it once the rail is back.
 */
export const compactQuery = `(max-width: ${String(compactWidth)}px)`

/**
 * Put this on anything inside the template that belongs to the compact layout
 * only, such as the button that opens the filters. It is shown while the rail
 * is hidden and leaves the layout and the tab order above that width.
 */
export const compactOnly = 'workbench__compact-only'

type WorkbenchTemplateProps = Readonly<{
  /** The bar above the workspace, usually a TopBar. */
  topBar: ReactNode
  /**
   * The navigation rail, usually a Sidebar. Hidden at `compactWidth` and
   * below, where `filters` reaches the same filters instead.
   */
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
   * bar's back button. Required, so a page without an open message can't
   * strand mobile users on an empty reader. It has no effect on wider
   * screens. The pane that hides takes focus with it, so on a switch the
   * caller moves focus into the pane that shows, e.g. the opened row after
   * going back.
   */
  mobilePane: 'queue' | 'reader'
  /**
   * The compact way to the filters the rail holds, usually a FilterSheet that
   * the caller opens from a control carrying `compactOnly` in the top bar. It
   * sits outside `main`, so it is no part of the queue or the reader. Left
   * out, the filters are the rail's alone and there is no way to them below
   * `compactWidth`.
   */
  filters?: ReactNode | undefined
  className?: string | undefined
}>

/**
 * The Compact workbench page layout: a top bar above a three-pane workspace
 * with the navigation rail, a bounded queue and a flexible reader. At 600px
 * and below it shows the top bar above one pane, the queue or the reader as
 * `mobilePane` says, instead of squeezing the columns. At 900px and below the
 * rail leaves the layout before that, because a rail and a bounded queue take
 * more than half of a tablet; the `filters` slot is the way to the same
 * filters there.
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
  mobilePane,
  filters,
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
      {filters}
    </div>
  )
}
