import type { InboxRefreshSummary } from './live-inbox'

const counted = (count: number, one: string, many = `${one}s`) =>
  `${String(count)} ${count === 1 ? one : many}`

/** Compact, honest feedback for changes proved by a complete loaded-window refresh. */
export function refreshNotice(summary: InboxRefreshSummary) {
  const changes = [
    summary.added > 0 ? counted(summary.added, 'new row') : undefined,
    summary.removed > 0 ? counted(summary.removed, 'row', 'rows') + ' left the view' : undefined,
    summary.updated > 0 ? counted(summary.updated, 'row') + ' updated' : undefined,
  ].filter((part): part is string => part !== undefined)
  const failures = summary.mailboxes.filter((mailbox) => mailbox.status !== 'refreshed').length
  return {
    title: changes.join(' · ') || 'No listed changes',
    detail:
      failures === 0
        ? `Loaded window read at ${summary.readAt}`
        : `${counted(failures, 'mailbox')} incomplete · loaded window read at ${summary.readAt}`,
  } as const
}
