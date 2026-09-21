import './Badge.css'

type BadgeProps = Readonly<{
  /** `review` is uncertain and needs a person, `done` is completed. */
  tone?: 'neutral' | 'review' | 'done' | undefined
  /** Always visible text: color alone never carries the state. */
  children: string
}>

/**
 * A compact status or category tag.
 *
 * @example
 * import { Badge } from '../components/atoms/Badge/Badge'
 *
 * <Badge tone="review">Needs review</Badge>
 * <Badge>Invoice</Badge>
 */
export function Badge({ tone = 'neutral', children }: BadgeProps) {
  return <span className={`badge badge--${tone}`}>{children}</span>
}
