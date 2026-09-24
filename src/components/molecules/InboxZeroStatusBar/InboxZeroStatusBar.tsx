import type { InboxCoverage, InboxViewCoverage } from '../../../app/inbox-coverage'
import './InboxZeroStatusBar.css'

type Tone = 'success' | 'attention' | 'danger' | 'neutral'

type Verdict = Readonly<{
  title: string
  detail: string
  tone: Tone
}>

const viewName = (view: InboxViewCoverage['view']) => (view === 'unread' ? 'Unread' : 'Other Inbox')

function resultName(result: InboxViewCoverage['result']) {
  if (result === 'complete') return 'Complete'
  if (result === 'failed') return 'Failed'
  return 'Incomplete'
}

const viewTone = (result: InboxViewCoverage['result']): Tone =>
  result === 'complete' ? 'success' : result === 'failed' ? 'danger' : 'attention'

function notConfirmedDetail(views: readonly InboxViewCoverage[]) {
  const failed = views.filter(({ result }) => result === 'failed')
  if (failed.length > 0) {
    return `Messages remain in the Inbox; ${failed.map(({ view }) => viewName(view)).join(' and ')} failed to scan.`
  }
  const incomplete = views.filter(({ result }) => result === 'incomplete')
  if (incomplete.length > 0) {
    return `Messages remain in the Inbox; ${incomplete.map(({ view }) => viewName(view)).join(' and ')} ${incomplete.length === 1 ? 'is' : 'are'} not fully scanned.`
  }
  return 'The complete scan found messages still in the Inbox.'
}

function verdict(coverage: InboxCoverage, refreshing: boolean): Verdict {
  const views = [coverage.unread, coverage.read]
  if (refreshing) {
    return {
      title: 'Inbox Zero verification pending',
      detail: 'Refreshing an Inbox view; the prior proof is temporarily withheld.',
      tone: 'attention',
    }
  }
  if (coverage.zero === 'confirmed') {
    return {
      title: 'Inbox Zero confirmed',
      detail: 'Unread and Other Inbox are fully scanned with zero messages.',
      tone: 'success',
    }
  }
  if (coverage.zero === 'not-confirmed') {
    return {
      title: 'Inbox Zero not reached',
      detail: notConfirmedDetail(views),
      tone: 'neutral',
    }
  }
  const failed = views.filter(({ result }) => result === 'failed')
  if (failed.length > 0) {
    return {
      title: 'Inbox Zero unknown',
      detail: `${failed.map(({ view }) => viewName(view)).join(' and ')} failed to scan.`,
      tone: 'danger',
    }
  }
  const incomplete = views.filter(({ result }) => result === 'incomplete')
  if (incomplete.length > 0) {
    return {
      title: 'Inbox Zero unknown',
      detail: `${incomplete.map(({ view }) => viewName(view)).join(' and ')} ${incomplete.length === 1 ? 'is' : 'are'} not fully scanned.`,
      tone: 'attention',
    }
  }
  return {
    title: 'Inbox Zero unknown',
    detail: 'The two views do not prove the same complete empty mailbox scope.',
    tone: 'attention',
  }
}

const timeLabel = (instant: string) =>
  new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(instant))

export function InboxZeroStatusBar({
  coverage,
  refreshing = false,
}: Readonly<{ coverage: InboxCoverage; refreshing?: boolean | undefined }>) {
  const status = verdict(coverage, refreshing)
  const views = [coverage.unread, coverage.read]
  return (
    <section
      className={`inbox-zero-status inbox-zero-status--${status.tone}`}
      aria-label="Inbox Zero scan status"
    >
      <div className="inbox-zero-status__verdict" role="status">
        <strong>{status.title}</strong>
        <span>{status.detail}</span>
      </div>
      <dl className="inbox-zero-status__views">
        {views.map((view) => (
          <div className="inbox-zero-status__view" key={view.view}>
            <dt>{viewName(view.view)}</dt>
            <dd
              className={`inbox-zero-status__result inbox-zero-status__result--${viewTone(view.result)}`}
            >
              {resultName(view.result)} · {String(view.loaded)}
            </dd>
          </div>
        ))}
      </dl>
      <p className="inbox-zero-status__meta">
        Non-atomic scan
        {coverage.startedAt && coverage.finishedAt ? (
          <>
            {' · commands ran '}
            <time dateTime={coverage.startedAt}>{timeLabel(coverage.startedAt)}</time>–
            <time dateTime={coverage.finishedAt}>{timeLabel(coverage.finishedAt)}</time>
          </>
        ) : (
          ' · scan interval incomplete'
        )}
        {' · mail may change between commands'}
      </p>
    </section>
  )
}
