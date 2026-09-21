import './Avatar.css'

type AvatarProps = Readonly<{
  /** One or two letters, for example `MV`. */
  initials: string
  /** The person's name. Leave it out when the name is already visible next to the avatar. */
  label?: string | undefined
  /** `sm` is 30px (top bar), `md` is 36px (sender in the reader). */
  size?: 'sm' | 'md' | undefined
}>

/**
 * A round initials marker for a person.
 *
 * @example
 * import { Avatar } from '../components/atoms/Avatar/Avatar'
 *
 * <Avatar initials="WS" label="Profile Wesley Smits" size="sm" />
 * <Avatar initials="MV" />
 */
export function Avatar({ initials, label, size = 'md' }: AvatarProps) {
  const a11y = label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true }
  return (
    <span className={`avatar avatar--${size}`} {...a11y}>
      {initials}
    </span>
  )
}
