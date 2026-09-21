import './AccountMarker.css'

type AccountMarkerProps = Readonly<{
  account: 'studio' | 'atelier' | 'personal'
}>

/**
 * An 8px color marker for a mailbox account. It is decorative: always show the
 * account name next to it.
 *
 * @example
 * import { AccountMarker } from '../components/atoms/AccountMarker/AccountMarker'
 *
 * <AccountMarker account="studio" /> Studio Noord
 */
export function AccountMarker({ account }: AccountMarkerProps) {
  return <span className={`account-marker account-marker--${account}`} aria-hidden />
}
