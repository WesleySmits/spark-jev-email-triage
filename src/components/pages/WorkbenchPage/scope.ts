import {
  maxInboxPages,
  type MailboxFailure as LiveMailboxFailure,
  type MailboxScope as LiveMailboxScope,
} from '../../../app/live-inbox'

/**
 * What the page says about its own reach. The queue holds a bounded reading
 * of a few mailboxes, never a whole mailbox, and these are the words for
 * that: what is loaded, what bounded it, what could not be read, and when it
 * was last read.
 *
 * Pure text from counted figures. Nothing here reads mail, and no figure is
 * estimated: a bound that may have cut a mailbox is reported as may, because
 * a listing that came back full proves only that more was never asked for.
 *
 * A bound and a failure are never said with one phrase. A bound left older
 * mail behind on purpose; a mailbox that could not be read left all of its
 * mail behind by accident, and only one of the two is worth retrying.
 */

/** What the page holds, what bounded it and what failed. The route counts these. */
export type QueueScope = Readonly<{
  view?: 'unread' | 'other'
  pages?: number
  /** Every mailbox the reading listed, failed ones included. */
  mailboxes: readonly LiveMailboxScope[]
  /**
   * The listed mailboxes that could not be read. Each holds 0 rows here
   * because nothing could be read from it, never because it is empty.
   */
  failed: readonly LiveMailboxFailure[]
  /** Earlier pages are shown, but a later page could not be read. */
  incomplete?: readonly LiveMailboxFailure[]
  /** Readable mailboxes the provider offered, before the mailbox bound. */
  readable: number
  /** At most this many mailboxes are loaded. */
  mailboxLimit: number
  /** At most this many recent Inbox messages are loaded per mailbox. */
  messageLimit: number
  /** Rows loaded across those mailboxes. */
  loaded: number
  /** Whether either bound may have cut the reading. */
  bounded: boolean
  /** When it was last read, already formatted, e.g. "09:42". */
  readAt: string
  /** Machine-readable form of `readAt`: the last successful refresh. */
  refreshedAt: string
}>

/** What the queue header says about the reading. */
export type ScopeText = Readonly<{
  /** The counted line: how much is loaded, from how many mailboxes it read. */
  summary: string
  /** What bounded it, and that search only covers what is loaded. */
  detail: string
  /**
   * What could not be read and how to try again, when something could not
   * be. Absent for a reading that read every mailbox it listed, so the
   * header says nothing about failure when there was none.
   */
  unread?: string | undefined
  /** When this reading was read, as words and as the instant behind them. */
  refreshed: Readonly<{ label: string; dateTime: string }>
  /** Whether a bound may have cut it. The header marks that line. */
  bounded: boolean
}>

const plural = (count: number, one: string, many = `${one}s`) =>
  `${String(count)} ${count === 1 ? one : many}`

/**
 * How the mailboxes this reading actually read are counted: "3 mailboxes"
 * when every readable one was read, "5 of 7 readable mailboxes" when the
 * mailbox bound left some out or a mailbox could not be read. A mailbox that
 * failed is not counted as read, because none of its mail is here.
 */
function mailboxCount({ mailboxes, readable, failed }: QueueScope) {
  const read = mailboxes.length - failed.length
  return readable > read
    ? `${String(read)} of ${plural(readable, 'readable mailbox', 'readable mailboxes')}`
    : plural(read, 'mailbox', 'mailboxes')
}

/**
 * Whether every mailbox this reading listed failed. It read no mail at all,
 * which is not the same as mailboxes that hold none, so the page says so in
 * its own words rather than showing an empty queue.
 */
const readNothing = (scope: QueueScope) =>
  scope.mailboxes.length > 0 && scope.failed.length === scope.mailboxes.length

/**
 * What could not be read, and that a refresh is what tries again. It names
 * the mailboxes and never what they hold, and it never guesses how much mail
 * is missing: a mailbox that did not answer said nothing about its size.
 */
function unreadBy(scope: QueueScope) {
  if (scope.failed.length === 0) return undefined
  const names = scope.failed.map((mailbox) => mailbox.label).join(', ')
  const one = scope.failed.length === 1
  const said = readNothing(scope)
    ? `No listed mailbox could be read, so no mail is shown (${names}).`
    : `${plural(scope.failed.length, 'mailbox', 'mailboxes')} could not be read, so none of ` +
      `${one ? 'its' : 'their'} mail is shown (${names}). The rest of this reading was read ` +
      `without ${one ? 'it' : 'them'}.`
  return `${said} How much ${one ? 'it holds' : 'they hold'} is unknown. Refresh to try again.`
}

/**
 * What each bound left out, as its own sentence. The two bounds cut different
 * mail and are never said with one phrase: the per-mailbox bound stops at the
 * oldest message it read, so what it leaves out is older, while a mailbox the
 * mailbox bound never reached is missing whole, newest mail included. Saying
 * "older mail" for a skipped mailbox would understate it.
 */
function cutBy(scope: QueueScope) {
  const skipped = scope.readable - scope.mailboxes.length
  const cut = scope.mailboxes.filter((mailbox) => mailbox.bounded).length
  const said: string[] = []
  if (skipped > 0) {
    said.push(
      `${plural(skipped, 'readable mailbox', 'readable mailboxes')} ${
        skipped === 1 ? 'was' : 'were'
      } not read at all, so even the newest mail in ${skipped === 1 ? 'it' : 'them'} is ` +
        `missing (at most ${plural(scope.mailboxLimit, 'mailbox', 'mailboxes')}).`,
    )
  }
  if (cut > 0) {
    said.push(
      `Older mail was left out of ${plural(cut, 'loaded mailbox', 'loaded mailboxes')} ` +
        `(at most ${plural(scope.messageLimit, 'recent Inbox message')} each).`,
    )
  }
  if (said.length > 0) return said
  // The all-clear is only the bounds', so it is withheld while a mailbox
  // could not be read: "nothing was cut" would read as "nothing is missing".
  if (scope.failed.length > 0) return []
  return [
    `Every readable mailbox was loaded and none reached the ` +
      `${plural(scope.messageLimit, 'recent Inbox message')} bound, so nothing was cut.`,
  ]
}

/**
 * The scope line for a reading: what it holds, and what it does not claim.
 * The summary always counts, the detail always names whichever bound left
 * something out and what the search reaches, and the refresh always names
 * when it was read, so nothing reads as a whole mailbox.
 *
 * The refresh line dates this reading, not the last whole one: every row
 * shown was read then, so a reading that lost a mailbox still says when the
 * mail beside it arrived, and nothing older is shown as fresh.
 */
export function scopeText(scope: QueueScope): ScopeText {
  if (scope.view) {
    const kind = scope.view === 'unread' ? 'unread' : 'other Inbox'
    const unread = unreadBy(scope)
    const incomplete = scope.incomplete?.length
      ? `Older ${kind} messages could not be loaded from ${scope.incomplete.map((mailbox) => mailbox.label).join(', ')}. Earlier pages remain visible; retry loading older messages.`
      : undefined
    const notices = [unread, incomplete].filter((notice) => notice !== undefined)
    const possible = scope.bounded
      ? scope.pages === maxInboxPages
        ? `Older ${kind} messages may remain beyond Spark's page limit.`
        : `Older ${kind} messages may remain; load more to continue.`
      : `No further ${kind} messages were found in the pages read.`
    return {
      summary: `Loaded: ${plural(scope.loaded, `${kind} message`)} from ${mailboxCount(scope)}`,
      detail:
        `${possible} Search and filters cover only loaded ${kind} messages. ` +
        'Read messages still in the Inbox count toward Inbox Zero.',
      ...(notices.length > 0 && { unread: notices.join(' ') }),
      refreshed: { label: `Last refreshed ${scope.readAt}.`, dateTime: scope.refreshedAt },
      bounded: scope.bounded,
    }
  }
  const loaded = plural(scope.loaded, 'recent message')
  const unread = unreadBy(scope)
  return {
    summary: `Loaded: ${loaded} from ${mailboxCount(scope)}`,
    detail: [...cutBy(scope), 'Search and filters cover only loaded mail.'].join(' '),
    ...(unread !== undefined && { unread }),
    refreshed: { label: `Last refreshed ${scope.readAt}.`, dateTime: scope.refreshedAt },
    bounded: scope.bounded,
  }
}

/**
 * What the Refresh control says it last did. It dates the loaded selection
 * rather than a mailbox, and when part of the reading could not be read it
 * says so, because Refresh is the one control that tries those mailboxes
 * again: a global retry that keeps what this reading did get.
 */
export function syncScopeLabel(scope: QueueScope) {
  const failed = scope.failed.length
  const unread =
    failed === 0 ? '' : ` · ${plural(failed, 'mailbox', 'mailboxes')} could not be read`
  const kind = scope.view === 'unread' ? 'unread' : scope.view === 'other' ? 'other Inbox' : 'mail'
  return `Loaded ${kind} updated at ${scope.readAt}${unread} · read only`
}

/**
 * What the queue says when it shows no rows. Four things end in an empty
 * queue and none of them mean each other, so each has its own words: every
 * mailbox failed, the reading loaded nothing from mailboxes it did read, a
 * filter matched nothing, and a mailbox that is simply empty is never
 * claimed at all.
 */
export function emptyScopeText(scope: QueueScope | undefined) {
  if (scope && readNothing(scope)) {
    const none =
      scope.mailboxes.length === 1
        ? 'The one listed mailbox did not answer'
        : `None of the ${plural(scope.mailboxes.length, 'listed mailbox', 'listed mailboxes')} ` +
          'answered'
    return {
      title: 'No mailbox could be read',
      description:
        `${none}, so this reading holds no mail. Nothing here says ` +
        `${scope.mailboxes.length === 1 ? 'that mailbox is' : 'those mailboxes are'} empty; ` +
        'refresh to read them again.',
    } as const
  }
  if (scope?.loaded === 0) {
    if (scope.view) {
      return {
        title:
          scope.view === 'unread' ? 'No unread messages loaded' : 'No other Inbox messages loaded',
        description:
          `No messages matched this view in ${mailboxCount(scope)}. ` +
          'Read messages may still be in the Inbox. This is not an Inbox Zero confirmation.',
      } as const
    }
    return {
      title: 'No mail loaded',
      description: `This reading holds no messages from ${mailboxCount(
        scope,
      )}. It is not proof that those mailboxes are empty; refresh to read them again.`,
    } as const
  }
  return {
    title: 'No results in this filter',
    description:
      'Choose another workflow or mailbox, or clear the search. Only loaded mail is searched.',
  } as const
}
