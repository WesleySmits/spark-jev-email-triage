/**
 * What the page says about its own reach. The queue holds a bounded reading
 * of a few mailboxes, never a whole mailbox, and these are the words for
 * that: what is loaded, what bounded it, and when it was last read.
 *
 * Pure text from counted figures. Nothing here reads mail, and no figure is
 * estimated: a bound that may have cut a mailbox is reported as may, because
 * a listing that came back full proves only that more was never asked for.
 */

/** How much of one mailbox the page holds. */
export type MailboxScope = Readonly<{
  id: string
  /** The mailbox as the rail names it, e.g. its address. */
  label: string
  /** Rows the page holds for it. */
  loaded: number
  /** Whether the per-mailbox bound may have cut it. */
  bounded: boolean
}>

/** What the page holds and what bounded it. The route counts these. */
export type QueueScope = Readonly<{
  mailboxes: readonly MailboxScope[]
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
  /** The counted line: how much is loaded, from how many mailboxes. */
  summary: string
  /** What bounded it, and that search only covers what is loaded. */
  detail: string
  /** The last successful refresh, as words and as the instant behind them. */
  refreshed: Readonly<{ label: string; dateTime: string }>
  /** Whether a bound may have cut it. The header marks that line. */
  bounded: boolean
}>

const plural = (count: number, one: string, many = `${one}s`) =>
  `${String(count)} ${count === 1 ? one : many}`

/**
 * How the loaded mailboxes are counted: "3 mailboxes" when every readable
 * one is loaded, "5 of 7 readable mailboxes" when the mailbox bound left
 * some out.
 */
function mailboxCount({ mailboxes, readable }: QueueScope) {
  const loaded = mailboxes.length
  return readable > loaded
    ? `${String(loaded)} of ${plural(readable, 'readable mailbox', 'readable mailboxes')}`
    : plural(loaded, 'mailbox', 'mailboxes')
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
  return [
    `Every readable mailbox was loaded and none reached the ` +
      `${plural(scope.messageLimit, 'recent Inbox message')} bound, so nothing was cut.`,
  ]
}

/**
 * The scope line for a reading: what it holds, and what it does not claim.
 * The summary always counts, the detail always names whichever bound left
 * something out and what the search reaches, and the refresh always names
 * when it was last read, so nothing reads as a whole mailbox.
 */
export function scopeText(scope: QueueScope): ScopeText {
  const loaded = plural(scope.loaded, 'recent message')
  return {
    summary: `Loaded: ${loaded} from ${mailboxCount(scope)}`,
    detail: [...cutBy(scope), 'Search and filters cover only loaded mail.'].join(' '),
    refreshed: { label: `Last refreshed ${scope.readAt}.`, dateTime: scope.refreshedAt },
    bounded: scope.bounded,
  }
}

/**
 * What the queue says when it shows no rows. A reading that loaded nothing
 * is not a filter that matched nothing, and neither is a whole mailbox being
 * empty, so the three read differently.
 */
export function emptyScopeText(scope: QueueScope | undefined) {
  if (scope?.loaded === 0) {
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
