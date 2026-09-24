import type { ReactElement } from 'react'
import './Icon.css'

// Line icons from the selected Compact workbench direction, drawn on a 24px grid.
const paths = {
  inbox: (
    <>
      <path d="M4 4h16v14H4z" />
      <path d="M4 13h4l2 3h4l2-3h4" />
    </>
  ),
  check: <path d="m5 12 4 4L19 6" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  alert: (
    <>
      <path d="M12 4 3 20h18z" />
      <path d="M12 9v5M12 17v.1" />
    </>
  ),
  search: (
    <>
      <circle cx="10" cy="10" r="6" />
      <path d="m15 15 5 5" />
    </>
  ),
  external: (
    <>
      <path d="M14 5h5v5M19 5l-9 9" />
      <path d="M17 13v6H5V7h6" />
    </>
  ),
  back: <path d="m15 5-7 7 7 7" />,
  more: (
    <>
      <circle cx="5" cy="12" r="1" />
      <circle cx="12" cy="12" r="1" />
      <circle cx="19" cy="12" r="1" />
    </>
  ),
  chevron: <path d="m6 9 6 6 6-6" />,
  undo: (
    <>
      <path d="m8 7-4 4 4 4" />
      <path d="M5 11h8a6 6 0 0 1 6 6" />
    </>
  ),
  // Added for the Spark connection states, in the same 24px line style.
  refresh: (
    <>
      <path d="M19 12a7 7 0 1 1-2.05-4.95" />
      <path d="M19 4v4h-4" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 11v5M12 8v.1" />
    </>
  ),
  // Added for compact filter access, in the same 24px line style.
  filter: <path d="M4 5h16l-6 7v7l-4-2v-5z" />,
  close: <path d="m6 6 12 12M18 6 6 18" />,
} satisfies Record<string, ReactElement>

type IconName = keyof typeof paths

export const iconNames = Object.keys(paths) as IconName[]

type IconProps = Readonly<{
  name: IconName
  /** `md` is 18px, `sm` is 14px. */
  size?: 'md' | 'sm' | undefined
  /** Accessible name. Leave it out when visible text already says the same. */
  label?: string | undefined
}>

/**
 * A line icon in the current text color.
 *
 * @example
 * import { Icon } from '../components/atoms/Icon/Icon'
 *
 * <Icon name="check" />
 * <Icon name="alert" size="sm" label="Needs review" />
 */
export function Icon({ name, size = 'md', label }: IconProps) {
  const a11y = label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true }
  return (
    <svg className={`icon icon--${size}`} viewBox="0 0 24 24" {...a11y}>
      {paths[name]}
    </svg>
  )
}
