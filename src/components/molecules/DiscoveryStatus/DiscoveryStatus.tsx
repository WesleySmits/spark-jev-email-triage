import type { InboxDiscoveryScope } from '../../../app/live-inbox'
import { Button } from '../../atoms/Button/Button'
import './DiscoveryStatus.css'

export type DiscoveryStatusProps = Readonly<{
  scope?: InboxDiscoveryScope | undefined
  error?: string | undefined
  loading: boolean
  onContinue: () => void
}>

const plural = (count: number, one: string, many = `${one}s`) =>
  `${String(count)} ${count === 1 ? one : many}`

/** Honest sender/subject search reach, compact enough for the queue header. */
export function DiscoveryStatus({ scope, error, loading, onContinue }: DiscoveryStatusProps) {
  if (!scope && !error) return null
  if (!scope) {
    return (
      <p className="discovery-status discovery-status--error" role="status">
        {error}
      </p>
    )
  }
  const failures = scope.failed.length + scope.incomplete.length
  return (
    <section className="discovery-status" aria-label="Search reach">
      <div className="discovery-status__summary">
        <p>
          <strong>“{scope.query}”</strong>
          <span>
            {plural(scope.matched, 'match', 'matches')} · {plural(scope.scanned, 'copy', 'copies')}{' '}
            scanned
          </span>
        </p>
        {scope.bounded && (
          <Button variant="secondary" disabled={loading} onClick={onContinue}>
            {loading ? 'Searching…' : 'Search further'}
          </Button>
        )}
      </div>
      <p className="discovery-status__detail">
        Sender + subject only · listed values may be truncated
      </p>
      {failures > 0 && (
        <p className="discovery-status__error" role="status">
          {plural(failures, 'mailbox')} could not be searched completely
        </p>
      )}
      <time className="discovery-status__time" dateTime={scope.searchCompletedAt}>
        Searched {scope.searchedAt}
      </time>
    </section>
  )
}
