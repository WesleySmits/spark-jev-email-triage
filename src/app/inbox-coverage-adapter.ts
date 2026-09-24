import type { InboxScope } from './live-inbox'
import { viewCoverage, type InboxViewCoverage } from './inbox-coverage'

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
