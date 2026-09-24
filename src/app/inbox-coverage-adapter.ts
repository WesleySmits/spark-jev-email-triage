import type { InboxScope } from './live-inbox'
import {
  failedCoverage,
  viewCoverage,
  type CoverageView,
  type InboxViewCoverage,
} from './inbox-coverage'

/** Browser-safe adapter: it only reshapes one read-only Inbox scope. */
export function coverageFromInboxScope(
  scope: InboxScope,
  startedAt = scope.refreshedAt,
): InboxViewCoverage {
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
