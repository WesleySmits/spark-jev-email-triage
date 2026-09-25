import type { MailboxReachItem } from '../components/organisms/MailboxReach/MailboxReach'
import type { SidebarItem } from '../components/organisms/Sidebar/Sidebar'
import type {
  InboxDiscoveryScope,
  InboxRefreshSummary,
  InboxScope,
  MailboxFailure,
} from './live-inbox'

type Marker = MailboxReachItem['account']

const markers: readonly Marker[] = ['studio', 'atelier', 'personal']

function markerFor(mailboxes: readonly SidebarItem[], id: string, index: number): Marker {
  const mailbox = mailboxes.find((candidate) => candidate.id === id)
  return mailbox?.account ?? markers[index % markers.length] ?? 'studio'
}

function failuresById(failures: readonly MailboxFailure[] | undefined) {
  return new Map(failures?.map((failure) => [failure.id, failure]) ?? [])
}

function reachState(
  id: string,
  bounded: boolean,
  failed: ReadonlyMap<string, MailboxFailure>,
  incomplete: ReadonlyMap<string, MailboxFailure>,
): MailboxReachItem['state'] {
  if (failed.has(id)) return 'failed'
  if (incomplete.has(id)) return 'incomplete'
  return bounded ? 'more' : 'complete'
}

function readTimes(
  scope: InboxScope | InboxDiscoveryScope,
  result: InboxRefreshSummary['mailboxes'][number] | undefined,
) {
  const scopeTimes =
    'searchedAt' in scope
      ? { readAt: scope.searchedAt, refreshedAt: scope.searchCompletedAt }
      : { readAt: scope.readAt, refreshedAt: scope.refreshedAt }
  return {
    readAt: result?.readAt ?? scopeTimes.readAt,
    refreshedAt: result?.refreshedAt ?? scopeTimes.refreshedAt,
  }
}

const copyCount = (
  mailbox: InboxScope['mailboxes'][number] | InboxDiscoveryScope['mailboxes'][number],
) => ('scanned' in mailbox ? mailbox.scanned : mailbox.loaded)

/** Maps the read-only refresh contract to Variant C's isolated mailbox rail section. */
export function mailboxReachItems(
  scope: InboxScope | InboxDiscoveryScope,
  mailboxes: readonly SidebarItem[],
  refresh?: InboxRefreshSummary,
): readonly MailboxReachItem[] {
  const failed = failuresById(scope.failed)
  const incomplete = failuresById(scope.incomplete)
  const refreshed = new Map(refresh?.mailboxes.map((mailbox) => [mailbox.id, mailbox]) ?? [])

  return scope.mailboxes.map((mailbox, index) => {
    const result = refreshed.get(mailbox.id)
    const state = reachState(mailbox.id, mailbox.bounded, failed, incomplete)
    const discovery = 'scanned' in mailbox
    const { readAt, refreshedAt } = readTimes(scope, result)
    const hasSuccessfulRead = state !== 'failed'

    return {
      id: mailbox.id,
      label: mailbox.label,
      account: markerFor(mailboxes, mailbox.id, index),
      pages: result?.pages ?? mailbox.pages ?? 0,
      copies: copyCount(mailbox),
      state,
      ...(hasSuccessfulRead && {
        lastRead: {
          label: `${discovery ? 'Last searched' : 'Last read'} ${readAt}`,
          dateTime: refreshedAt,
        },
      }),
    }
  })
}
