import { Fragment, useId } from 'react'
import { Checkbox } from '../../atoms/Checkbox/Checkbox'
import { KeyboardHint } from '../../atoms/KeyboardHint/KeyboardHint'
import './ShortcutLegend.css'

type Shortcut = Readonly<{
  /** Visible name of the action, for example "Next / previous". Unique in the legend. */
  label: string
  /** Keys in the order the label names their actions, for example `['K', 'J']`. */
  keys: readonly [string, ...string[]]
}>

type ShortcutSetting = Readonly<{
  /** Visible text and accessible name, for example "Single-key shortcuts". */
  label: string
  /** Whether the keys are on. The caller owns this state. */
  on: boolean
  /** Called with the new value when the user changes the box. */
  onChange: (on: boolean) => void
  /** One line saying what the current value means. It names the box. */
  note?: string | undefined
}>

type ShortcutLegendProps = Readonly<{
  /** One row per action. An empty list renders no rows. */
  shortcuts: readonly Shortcut[]
  /**
   * A checkbox under the rows that turns the keys off and on. Left out, the
   * legend only lists what the caller gave it.
   */
  setting?: ShortcutSetting | undefined
  className?: string | undefined
}>

function Rows({ shortcuts }: Pick<ShortcutLegendProps, 'shortcuts'>) {
  return (
    <dl className="shortcut-legend__list">
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

/** The switch for the keys, with the note that says what it currently means. */
function Setting({ label, on, onChange, note }: ShortcutSetting) {
  const noteId = `${useId()}-note`
  return (
    <div className="shortcut-legend__setting">
      <Checkbox
        label={label}
        checked={on}
        {...(note !== undefined && { 'aria-describedby': noteId })}
        onChange={(event) => {
          onChange(event.target.checked)
        }}
      />
      {note !== undefined && (
        <p id={noteId} className="shortcut-legend__note">
          {note}
        </p>
      )}
    </div>
  )
}

/**
 * A compact list of keyboard shortcuts: each action's label with its keys at
 * the end of the row, and optionally a checkbox that turns the keys off and
 * on. It shows the shortcuts and reports the choice; the caller handles the
 * keys, stores the choice and makes sure they don't fire while the user types
 * in a field. Without shortcuts and without a setting it renders nothing.
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
 *   setting={{
 *     label: 'Single-key shortcuts',
 *     on: true,
 *     note: 'K, J, E and / act without a modifier.',
 *     onChange: (on) => keep(on),
 *   }}
 * />
 */
export function ShortcutLegend({ shortcuts, setting, className }: ShortcutLegendProps) {
  if (shortcuts.length === 0 && setting === undefined) return null
  const classes = ['shortcut-legend', className].filter(Boolean).join(' ')
  return (
    <div className={classes}>
      {shortcuts.length > 0 && <Rows shortcuts={shortcuts} />}
      {setting !== undefined && <Setting {...setting} />}
    </div>
  )
}
