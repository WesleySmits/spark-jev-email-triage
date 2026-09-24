import type { InboxListRequest, InboxScope } from './live-inbox'
import {
  failedCoverage,
  viewCoverage,
  type CoverageView,
  type InboxCoverage,
  type InboxViewCoverage,
} from './inbox-coverage'

/** Browser-safe adapter: it only reshapes one read-only Inbox scope. */
export function coverageFromInboxScope(scope: InboxScope, startedAt: string): InboxViewCoverage {
  return viewCoverage({
    view: scope.view,
    mailboxes: scope.mailboxes,
    failed: scope.failed,
    incomplete: scope.incomplete,
    readable: scope.readable,
    loaded: scope.loaded,
    bounded: scope.bounded,
    startedAt,
    refreshedAt: scope.refreshedAt,
  })
}

/** Capture a real start before the first provider command begins. */
export async function readWithStart<T>(
  read: () => Promise<T>,
  now = () => new Date().toISOString(),
) {
  const startedAt = now()
  return { value: await read(), startedAt } as const
}

/**
 * A cursor continues the same accumulated view scan. Fresh reads, including
 * refreshes and the first read of another view, begin a new interval.
 */
export function startedAtForRequest(
  previous: InboxCoverage | undefined,
  request: InboxListRequest,
  now: string,
) {
  if (!request.cursor) return now
  const view = request.view === 'unread' ? previous?.unread : previous?.read
  return view?.startedAt ?? now
}

type CoveredRead<T> =
  | Readonly<{ status: 'ready'; value: T; update: InboxViewCoverage }>
  | Readonly<{ status: 'failed'; update: InboxViewCoverage }>

/** An unexpected read throw closes only the requested view and never strands loading state. */
export async function readWithCoverage<T>(
  view: CoverageView,
  startedAt: string,
  read: () => Promise<T>,
  coverageOf: (value: T, finishedAt: string) => InboxViewCoverage,
  now = () => new Date().toISOString(),
): Promise<CoveredRead<T>> {
  try {
    const value = await read()
    const finishedAt = now()
    return { status: 'ready', value, update: coverageOf(value, finishedAt) }
  } catch {
    return { status: 'failed', update: failedCoverage(view, startedAt, now()) }
  }
}
