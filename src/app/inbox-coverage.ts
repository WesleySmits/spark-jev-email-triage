/**
 * The cross-view proof behind an Inbox Zero statement. Pure data only: this
 * module reads no mail and makes no claim from a single view.
 */

export type CoverageView = 'unread' | 'other'
export type CoverageResult = 'complete' | 'incomplete' | 'failed'
export type ZeroResult = 'confirmed' | 'not-confirmed' | 'unknown'
export type CoverageReason = 'not-scanned' | 'more-pages' | 'mailbox-errors' | 'provider-failure'

export interface CoverageFailure {
  id: string
  label: string
  reason: 'missing' | 'failed' | 'malformed'
}

export interface CoverageMailboxInput {
  id: string
  label: string
  loaded: number
  bounded: boolean
}

export interface CoverageScopeInput {
  view: CoverageView
  mailboxes: readonly CoverageMailboxInput[]
  failed: readonly CoverageFailure[]
  incomplete?: readonly CoverageFailure[] | undefined
  readable: number
  loaded: number
  bounded: boolean
  startedAt: string
  refreshedAt: string
}

export interface MailboxCoverage {
  id: string
  label: string
  loaded: number
  result: CoverageResult
}

export interface InboxViewCoverage {
  view: CoverageView
  result: CoverageResult
  reasons: readonly CoverageReason[]
  mailboxes: readonly MailboxCoverage[]
  failed: readonly CoverageFailure[]
  incomplete: readonly CoverageFailure[]
  readable: number | null
  loaded: number
  startedAt: string | null
  finishedAt: string | null
}

export interface InboxCoverage {
  unread: InboxViewCoverage
  read: InboxViewCoverage
  zero: ZeroResult
  /** Commands run in sequence, so the two views never represent one instant. */
  nonAtomic: true
  startedAt: string | null
  finishedAt: string | null
}

export const unscannedCoverage = (view: CoverageView): InboxViewCoverage => ({
  view,
  result: 'incomplete',
  reasons: ['not-scanned'],
  mailboxes: [],
  failed: [],
  incomplete: [],
  readable: null,
  loaded: 0,
  startedAt: null,
  finishedAt: null,
})

/** A provider-level failure knows no mailbox contents and is never empty. */
export function failedCoverage(
  view: CoverageView,
  startedAt: string,
  finishedAt: string,
): InboxViewCoverage {
  return {
    ...unscannedCoverage(view),
    result: 'failed',
    reasons: ['provider-failure'],
    startedAt,
    finishedAt,
  }
}

/** Turn one selected-view reading into an explicit, per-mailbox result. */
export function viewCoverage(scope: CoverageScopeInput): InboxViewCoverage {
  const failed = new Set(scope.failed.map(({ id }) => id))
  const incomplete = new Set(scope.incomplete?.map(({ id }) => id) ?? [])
  const mailboxes = scope.mailboxes.map(({ id, label, loaded, bounded }) => ({
    id,
    label,
    loaded,
    result: failed.has(id)
      ? ('failed' as const)
      : incomplete.has(id) || bounded
        ? ('incomplete' as const)
        : ('complete' as const),
  }))
  const allFailed = mailboxes.length > 0 && mailboxes.every(({ result }) => result === 'failed')
  const hasErrors = scope.failed.length > 0 || (scope.incomplete?.length ?? 0) > 0
  const result = allFailed ? 'failed' : hasErrors || scope.bounded ? 'incomplete' : 'complete'
  const reasons = [
    ...(scope.bounded ? (['more-pages'] as const) : []),
    ...(hasErrors ? (['mailbox-errors'] as const) : []),
  ]
  return {
    view: scope.view,
    result,
    reasons,
    mailboxes,
    failed: scope.failed,
    incomplete: scope.incomplete ?? [],
    readable: scope.readable,
    loaded: scope.loaded,
    startedAt: scope.startedAt,
    finishedAt: scope.refreshedAt,
  }
}

export function inboxCoverage(
  previous: InboxCoverage | undefined,
  update: InboxViewCoverage,
): InboxCoverage {
  const unread =
    update.view === 'unread' ? update : (previous?.unread ?? unscannedCoverage('unread'))
  const read = update.view === 'other' ? update : (previous?.read ?? unscannedCoverage('other'))
  const views = [unread, read]
  const bothComplete = views.every(({ result }) => result === 'complete')
  const anyMessages = views.some(({ loaded }) => loaded > 0)
  const hasReadableScope = views.every(({ readable }) => readable !== null && readable > 0)
  const zero: ZeroResult =
    bothComplete && hasReadableScope && !anyMessages
      ? 'confirmed'
      : anyMessages
        ? 'not-confirmed'
        : 'unknown'
  const starts = views.flatMap(({ startedAt }) => (startedAt === null ? [] : [startedAt]))
  const finishes = views.flatMap(({ finishedAt }) => (finishedAt === null ? [] : [finishedAt]))
  return {
    unread,
    read,
    zero,
    nonAtomic: true,
    startedAt: starts.sort().at(0) ?? null,
    finishedAt: finishes.sort().at(-1) ?? null,
  }
}
