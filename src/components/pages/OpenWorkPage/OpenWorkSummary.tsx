import type { OpenWorkRead } from '../../../app/open-work'
import { Button } from '../../atoms/Button/Button'

type Props = Readonly<{
  mode: 'work' | 'completed'
  reading: Extract<OpenWorkRead, { status: 'ready' }>
  visibleCount: number
  loading: boolean
  onRefresh: () => void
}>

const headings = { work: 'Open work', completed: 'Completed decisions' } as const
const emptyMessages = {
  work: 'No open local work has been recorded. This says nothing about unread mail or an empty Inbox.',
  completed: 'No completed local decisions have been recorded.',
} as const

const emptyFor = (mode: Props['mode'], hasOlder: boolean) =>
  hasOlder
    ? `No ${mode === 'work' ? 'open work' : 'completed decisions'} in the loaded copies. Older decisions are available below.`
    : emptyMessages[mode]

/** Counts and timestamps describe the pages loaded in this browser view. */
export function OpenWorkSummary({ mode, reading, visibleCount, loading, onRefresh }: Props) {
  return (
    <>
      <header>
        <div>
          <h1>{headings[mode]}</h1>
          <p>Local decisions about mailbox copies. Spark Inbox and unread counts are separate.</p>
        </div>
        <Button type="button" variant="secondary" disabled={loading} onClick={onRefresh}>
          {loading ? 'Checking…' : 'Check Spark again'}
        </Button>
      </header>
      <p className="open-work__counts">
        Loaded copies: {reading.items.length} · {reading.tally.open} open · {reading.tally.overdue}{' '}
        overdue · {reading.tally.completed} completed · {reading.tally.unknown} unknown ·{' '}
        {reading.tally.conflicts} conflicts
      </p>
      <p className="open-work__verification">
        Counts cover loaded copies only. Spark evidence is checked when each page loads; latest page
        checked {new Date(reading.checkedAt).toLocaleString()}. Unknown means no current proof.
      </p>
      {visibleCount === 0 && (
        <p className="open-work__empty">{emptyFor(mode, reading.nextCursor !== null)}</p>
      )}
    </>
  )
}
