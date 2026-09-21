import './StatusDot.css'

type StatusDotProps = Readonly<{
  /** `success` is connected or completed, `danger` is disconnected or failed. */
  tone?: 'success' | 'danger' | undefined
  /**
   * Accessible name. Leave it out when visible text next to the dot already
   * names the state, which is the expected use.
   */
  label?: string | undefined
}>

/**
 * A 7px state dot, as next to the sync status. It never carries the state on
 * its own: pair it with visible status text. `danger` also adds a soft ring,
 * so the two tones differ in shape as well as color.
 *
 * @example
 * import { StatusDot } from '../components/atoms/StatusDot/StatusDot'
 *
 * <StatusDot /> Updated 2 min ago
 * <StatusDot tone="danger" /> Disconnected · last sync 10:14
 */
export function StatusDot({ tone = 'success', label }: StatusDotProps) {
  const a11y = label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true }
  return <span className={`status-dot status-dot--${tone}`} {...a11y} />
}
