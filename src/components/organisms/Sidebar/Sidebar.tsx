import { useId, type ComponentProps } from 'react'
import type { AccountMarker } from '../../atoms/AccountMarker/AccountMarker'
import type { Icon } from '../../atoms/Icon/Icon'
import { NavigationItem } from '../../molecules/NavigationItem/NavigationItem'
import { ShortcutLegend } from '../../molecules/ShortcutLegend/ShortcutLegend'
import './Sidebar.css'

/** Either an icon or an account marker leads the row, never both. */
type Lead =
  | { icon: ComponentProps<typeof Icon>['name']; account?: undefined }
  | { account: ComponentProps<typeof AccountMarker>['account']; icon?: undefined }

export type SidebarItem = Readonly<
  Lead & {
    /** Unique in its group. Passed to `onSelect`. */
    id: string
    /** Visible text and accessible name. Truncated with an ellipsis when narrow. */
    label: string
    count?: number | undefined
    disabled?: boolean | undefined
  }
>

export type SidebarGroup = Readonly<{
  /** Unique in the sidebar. Passed to `onSelect`. */
  id: string
  /** Visible overline and the name of the group's nav landmark. Unique in the page. */
  label: string
  items: readonly SidebarItem[]
  /** The applied item, or null when none is. The caller owns this state. */
  selectedId?: string | null | undefined
  /** Shown instead of the rows when `items` is empty. Without it, an empty group is left out. */
  emptyLabel?: string | undefined
}>

type SidebarProps = Readonly<{
  /** Names the complementary landmark, for example "Filters". */
  label: string
  groups: readonly SidebarGroup[]
  /** Called with the group and item ids when a row is pressed. */
  onSelect: (groupId: string, itemId: string) => void
  /** Shown in the fixed help area at the bottom. Empty or left out: no help area. */
  shortcuts?: ComponentProps<typeof ShortcutLegend>['shortcuts'] | undefined
  /**
   * A checkbox in the help area that turns the shortcuts off and on. The
   * caller owns the choice and the keys; the rail only shows it.
   */
  shortcutSetting?: ComponentProps<typeof ShortcutLegend>['setting'] | undefined
  className?: string | undefined
}>

function lead(item: SidebarItem): Lead {
  return item.icon ? { icon: item.icon } : { account: item.account }
}

type GroupProps = Readonly<{ group: SidebarGroup; onSelect: SidebarProps['onSelect'] }>

function Group({ group, onSelect }: GroupProps) {
  const labelId = `${useId()}-label`
  return (
    <nav className="sidebar__group" aria-labelledby={labelId}>
      <p id={labelId} className="sidebar__label">
        {group.label}
      </p>
      {group.items.length === 0 ? (
        <p className="sidebar__empty">{group.emptyLabel}</p>
      ) : (
        <ul className="sidebar__list" role="list">
          {group.items.map((item) => (
            <li key={item.id}>
              <NavigationItem
                {...lead(item)}
                label={item.label}
                count={item.count}
                disabled={item.disabled}
                active={group.selectedId === item.id}
                onClick={() => {
                  onSelect(group.id, item.id)
                }}
              />
            </li>
          ))}
        </ul>
      )}
    </nav>
  )
}

/**
 * The navigation rail of the Compact workbench: labeled filter groups, such
 * as workflow and mailbox, in a scrolling area, with an optional shortcut
 * legend in a fixed help area below. It is presentational: the caller owns the
 * items, counts, selection, filtering, routing and the keys themselves. It
 * fills the height its container gives it; the app shell places it.
 *
 * @example
 * import { Sidebar } from '../components/organisms/Sidebar/Sidebar'
 *
 * <Sidebar
 *   label="Filters"
 *   groups={[
 *     { id: 'workflow', label: 'Workflow', selectedId: workflow, items: [{ id: 'review', icon: 'clock', label: 'Needs review', count: 3 }] },
 *     { id: 'mailbox', label: 'Mailboxes', selectedId: mailbox, items: [{ id: 'studio', account: 'studio', label: 'Studio Noord', count: 4 }] },
 *   ]}
 *   onSelect={(groupId, itemId) => select(groupId, itemId)}
 *   shortcuts={[{ label: 'Next / previous', keys: ['K', 'J'] }]}
 * />
 */
export function Sidebar({
  label,
  groups,
  onSelect,
  shortcuts = [],
  shortcutSetting,
  className,
}: SidebarProps) {
  const classes = ['sidebar', className].filter(Boolean).join(' ')
  const visible = groups.filter((group) => group.items.length > 0 || group.emptyLabel)
  return (
    <aside className={classes} aria-label={label}>
      <div className="sidebar__scroll">
        {visible.map((group) => (
          <Group key={group.id} group={group} onSelect={onSelect} />
        ))}
      </div>
      {(shortcuts.length > 0 || shortcutSetting !== undefined) && (
        <div className="sidebar__help">
          <ShortcutLegend shortcuts={shortcuts} setting={shortcutSetting} />
        </div>
      )}
    </aside>
  )
}
