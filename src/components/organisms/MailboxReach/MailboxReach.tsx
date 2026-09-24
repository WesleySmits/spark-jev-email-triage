import { useId } from 'react'
import { AccountMarker } from '../../atoms/AccountMarker/AccountMarker'
import './MailboxReach.css'

export type MailboxReachItem = Readonly<{
  id: string
  label: string
  account: 'studio' | 'atelier' | 'personal'
  pages: number
  copies: number
  state: 'more' | 'complete' | 'failed' | 'incomplete'
  lastRead?: Readonly<{ label: string; dateTime: string }> | undefined
}>

type MailboxReachProps = Readonly<{
  items: readonly MailboxReachItem[]
  selectedId?: string | null | undefined
  onSelect: (id: string) => void
  onRetry?: ((id: string) => void) | undefined
  retryingIds?: ReadonlySet<string> | undefined
  className?: string | undefined
}>

const plural = (count: number, one: string, many = `${one}s`) =>
  `${String(count)} ${count === 1 ? one : many}`

function stateLabel(state: MailboxReachItem['state']) {
  if (state === 'more') return 'more'
  if (state === 'complete') return 'complete'
  return state === 'failed' ? 'retry' : 'retry older'
}

/** Variant C's compact mailbox scope: reach, freshness and retry live in the rail. */
export function MailboxReach({
  items,
  selectedId,
  onSelect,
  onRetry,
  retryingIds = new Set(),
  className,
}: MailboxReachProps) {
  const titleId = `${useId()}-title`
  const classes = ['mailbox-reach', className].filter(Boolean).join(' ')
  return (
    <section className={classes} aria-labelledby={titleId}>
      <h2 id={titleId} className="mailbox-reach__title">
        Mailbox reach
      </h2>
      <ul className="mailbox-reach__list" role="list">
        {items.map((item) => {
          const failed = item.state === 'failed' || item.state === 'incomplete'
          const retrying = retryingIds.has(item.id)
          return (
            <li key={item.id} className="mailbox-reach__item">
              <button
                type="button"
                className="mailbox-reach__select"
                aria-pressed={selectedId === item.id}
                onClick={() => {
                  onSelect(item.id)
                }}
              >
                <AccountMarker account={item.account} />
                <span className="mailbox-reach__copy">
                  <span className="mailbox-reach__label">{item.label}</span>
                  <span className="mailbox-reach__detail">
                    {plural(item.pages, 'page')} · {plural(item.copies, 'copy', 'copies')}
                    {!failed && (
                      <span className={`mailbox-reach__state mailbox-reach__state--${item.state}`}>
                        {' · '}
                        {stateLabel(item.state)}
                      </span>
                    )}
                  </span>
                  {item.lastRead && (
                    <time className="mailbox-reach__time" dateTime={item.lastRead.dateTime}>
                      {item.lastRead.label}
                    </time>
                  )}
                </span>
              </button>
              {failed && onRetry && (
                <button
                  type="button"
                  className="mailbox-reach__retry"
                  disabled={retrying}
                  onClick={() => {
                    onRetry(item.id)
                  }}
                >
                  {retrying ? 'Retrying…' : stateLabel(item.state)}
                </button>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
