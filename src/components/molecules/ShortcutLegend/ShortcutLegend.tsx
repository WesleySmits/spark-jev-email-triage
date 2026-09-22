import { Fragment } from 'react'
import { KeyboardHint } from '../../atoms/KeyboardHint/KeyboardHint'
import './ShortcutLegend.css'

type Shortcut = Readonly<{
  /** Visible name of the action, for example "Next / previous". Unique in the legend. */
  label: string
  /** Keys in the order the label names their actions, for example `['K', 'J']`. */
  keys: readonly [string, ...string[]]
}>

type ShortcutLegendProps = Readonly<{
  /** One row per action. An empty list renders nothing. */
  shortcuts: readonly Shortcut[]
  className?: string | undefined
}>

/**
 * A compact list of keyboard shortcuts: each action's label with its keys at
 * the end of the row. It only shows the shortcuts. The caller handles the keys
 * and makes sure they don't fire while the user types in a field.
 *
 * It sets no padding or border, so the container places it. Keys wrap below a
 * label that no longer fits.
 *
 * @example
 * import { ShortcutLegend } from '../components/molecules/ShortcutLegend/ShortcutLegend'
 *
 * <ShortcutLegend
 *   shortcuts={[
 *     { label: 'Next / previous', keys: ['K', 'J'] },
 *     { label: 'Complete', keys: ['E'] },
 *   ]}
 * />
 */
export function ShortcutLegend({ shortcuts, className }: ShortcutLegendProps) {
  if (shortcuts.length === 0) return null
  const classes = ['shortcut-legend', className].filter(Boolean).join(' ')
  return (
    <dl className={classes}>
      {shortcuts.map(({ label, keys }) => (
        <div key={label} className="shortcut-legend__row">
          <dt className="shortcut-legend__label">{label}</dt>
          <dd className="shortcut-legend__keys">
            {keys.map((key, index) => (
              // A real space, so "K J" is read as two keys and not as "KJ".
              <Fragment key={key}>
                {index > 0 && ' '}
                <KeyboardHint>{key}</KeyboardHint>
              </Fragment>
            ))}
          </dd>
        </div>
      ))}
    </dl>
  )
}
