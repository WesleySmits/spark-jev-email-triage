import './WorkspaceTabs.css'

/** One tab: its name, its own count and where that count comes from. */
export type WorkspaceTab = Readonly<{
  id: string
  /** The visible name, e.g. "Spark Inbox". */
  label: string
  /** The tab's own count, already formatted, e.g. "10 loaded" or "3". */
  count: string
  /**
   * What the count is of, read with the tab's name, e.g. "open work saved in
   * this app". It keeps two counts from different sources from reading as
   * one figure.
   */
  countLabel: string
}>

type WorkspaceTabsProps = Readonly<{
  /** Names the navigation, e.g. "Workbench lists". */
  label: string
  tabs: readonly WorkspaceTab[]
  /** The id of the tab that is showing. */
  current: string
  onSelect: (id: string) => void
  className?: string | undefined
}>

/**
 * Switches the queue pane between lists that come from different sources,
 * such as Spark's Inbox and the work saved in this app. Each tab carries its
 * own count and says what it counts, so the two are never read as one total.
 *
 * Presentational and controlled: the caller owns which tab shows and what
 * each count says. It follows the Inbox view bar: a labelled navigation of
 * buttons, the current one marked with `aria-current`, so Tab and Enter are
 * all it needs and nothing here moves focus.
 *
 * @example
 * import { WorkspaceTabs } from '../components/molecules/WorkspaceTabs/WorkspaceTabs'
 *
 * <WorkspaceTabs
 *   label="Workbench lists"
 *   current={tab}
 *   onSelect={setTab}
 *   tabs={[
 *     { id: 'inbox', label: 'Spark Inbox', count: '10 loaded', countLabel: 'messages loaded from Spark' },
 *     { id: 'work', label: 'Open work', count: '3', countLabel: 'open items saved in this app' },
 *   ]}
 * />
 */
export function WorkspaceTabs({ label, tabs, current, onSelect, className }: WorkspaceTabsProps) {
  const classes = ['workspace-tabs', className].filter(Boolean).join(' ')
  return (
    <nav className={classes} aria-label={label}>
      <ul className="workspace-tabs__list">
        {tabs.map((tab) => (
          <li key={tab.id}>
            <button
              type="button"
              className="workspace-tabs__tab"
              aria-current={tab.id === current ? 'page' : undefined}
              onClick={() => {
                onSelect(tab.id)
              }}
            >
              <span className="workspace-tabs__label">{tab.label}</span>
              <span className="workspace-tabs__count" aria-hidden="true">
                {tab.count}
              </span>
              <span className="workspace-tabs__sr">{`: ${tab.count} ${tab.countLabel}`}</span>
            </button>
          </li>
        ))}
      </ul>
    </nav>
  )
}
