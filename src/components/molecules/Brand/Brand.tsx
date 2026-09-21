import { Icon } from '../../atoms/Icon/Icon'
import './Brand.css'

type BrandProps = Readonly<{
  /** Product name: the visible wordmark, or the mark's accessible name without it. */
  name?: string | undefined
  /** `md` is the 25px desktop mark, `sm` the 24px mobile mark. */
  size?: 'md' | 'sm' | undefined
  /** Shows the name next to the mark. Defaults to true. */
  wordmark?: boolean | undefined
  className?: string | undefined
}>

/**
 * The Spark Triage brand: the inbox glyph in an outlined square, and the
 * wordmark. The visible name is the accessible name, so the glyph is
 * decorative. Without the wordmark the mark becomes an image named `name`.
 * It is not a link or a heading; wrap it in one when the page needs that.
 *
 * @example
 * import { Brand } from '../components/molecules/Brand/Brand'
 *
 * <Brand />
 * <a href="/"><Brand size="sm" /></a>
 */
export function Brand({
  name = 'Spark Triage',
  size = 'md',
  wordmark = true,
  className,
}: BrandProps) {
  const classes = ['brand', `brand--${size}`, className].filter(Boolean).join(' ')
  return (
    <span className={classes}>
      <span className="brand__mark">
        <Icon name="inbox" label={wordmark ? undefined : name} />
      </span>
      {wordmark && <span className="brand__name">{name}</span>}
    </span>
  )
}
