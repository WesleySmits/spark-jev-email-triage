import { useRef, useState } from 'react'
import type {
  OpenWorkRead,
  WorkDecisionRequest,
  WorkDecisionResult,
  WorkMessageRead,
} from '../../../app/open-work'
import type { OpenWorkItem } from '../../../domain/open-work'
import { Button } from '../../atoms/Button/Button'
import { OpenWorkReader } from './OpenWorkReader'
import './OpenWorkPage.css'

type Props = Readonly<{
  mode: 'work' | 'completed'
  reading: OpenWorkRead
  loading: boolean
  onRefresh: () => void
  onRecord: (request: WorkDecisionRequest) => Promise<WorkDecisionResult>
  onRead: (copy: OpenWorkItem['copy']) => Promise<WorkMessageRead>
}>

const labels = {
  open: 'Open',
  overdue: 'Overdue',
  completed: 'Completed decisions',
  unknown: 'Could not verify',
} as const

const headings = { work: 'Open work', completed: 'Completed decisions' } as const
const emptyMessages = {
  work: 'No open local work has been recorded. This says nothing about unread mail or an empty Inbox.',
  completed: 'No completed local decisions have been recorded.',
} as const

const visibleIn = (items: readonly OpenWorkItem[], mode: Props['mode']) =>
  items.filter((item) => (item.group === 'completed') === (mode === 'completed'))

function WorkControls({
  item,
  onRecord,
}: Readonly<{
  item: OpenWorkItem
  onRecord: Props['onRecord']
}>) {
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState('')
  const latest = item.history[0]
  const target = latest?.target
  const verified = item.work.state !== 'unobserved' && item.work.state !== 'lapsed'
  const save = (kind: 'reopen' | 'handled_in_spark') => {
    if (!target) return
    setSaving(true)
    void onRecord({ target, kind, dueAt: null, requestId: crypto.randomUUID() })
      .then((answer) => {
        setResult(
          answer.status === 'recorded'
            ? kind === 'reopen'
              ? 'Reopened locally.'
              : 'Handled-in-Spark claim saved locally. No Spark command ran.'
            : `Could not save: ${answer.status === 'refused' ? answer.reason : answer.status}.`,
        )
      })
      .finally(() => {
        setSaving(false)
      })
  }
  return (
    <>
      {latest?.kind === 'handled_in_spark' && (
        <Button
          variant="secondary"
          type="button"
          disabled={saving || !verified}
          onClick={() => {
            save('reopen')
          }}
        >
          Reopen this version
        </Button>
      )}
      {item.group !== 'completed' && (
        <Button
          variant="secondary"
          type="button"
          disabled={saving || !verified}
          onClick={() => {
            save('handled_in_spark')
          }}
        >
          I handled this in Spark
        </Button>
      )}
      <p role="status">{result}</p>
    </>
  )
}

function WorkRow({
  item,
  onRecord,
  onRead,
  selected,
}: Readonly<{
  item: OpenWorkItem
  onRecord: Props['onRecord']
  onRead: () => void
  selected: boolean
}>) {
  const latest = item.history[0]
  return (
    <li className="open-work__item" data-selected={selected}>
      <div>
        <strong className="open-work__copy">
          {item.copy.mailboxId} · {item.copy.messageId}
        </strong>
        <p className="open-work__meta">
          {latest?.kind.replaceAll('_', ' ')} · {latest?.decidedBy} · {latest?.decidedAt}
        </p>
        {item.dueAt && (
          <p className="open-work__due">Due {new Date(item.dueAt).toLocaleString()}</p>
        )}
        <p className="open-work__meta">
          Inbox: {item.inbox.status.replaceAll('_', ' ')}
          {item.inbox.status === 'unknown' ? ` (${item.inbox.reason.replaceAll('_', ' ')})` : ''}
        </p>
        {item.conflicts.length > 0 && (
          <p className="open-work__alert" role="alert">
            Check: {item.conflicts.map((conflict) => conflict.replaceAll('_', ' ')).join(', ')}
          </p>
        )}
        <details>
          <summary>Decision history ({item.history.length})</summary>
          <ol>
            {item.history.map((decision, index) => (
              <li key={`${decision.decidedAt}-${String(index)}`}>
                {decision.kind.replaceAll('_', ' ')} · {decision.decidedBy} · {decision.decidedAt}
              </li>
            ))}
          </ol>
        </details>
      </div>
      <Button type="button" variant="secondary" aria-pressed={selected} onClick={onRead}>
        Read current thread
      </Button>
      <WorkControls item={item} onRecord={onRecord} />
    </li>
  )
}

function WorkGroups({
  items,
  mode,
  onRecord,
  onOpen,
  selectedId,
}: Readonly<{
  items: readonly OpenWorkItem[]
  mode: Props['mode']
  onRecord: Props['onRecord']
  onOpen: (item: OpenWorkItem) => void
  selectedId: string | undefined
}>) {
  return (
    <div>
      {(mode === 'work' ? (['overdue', 'open', 'unknown'] as const) : (['completed'] as const)).map(
        (group) => {
          const groupItems = items.filter((item) => item.group === group)
          if (groupItems.length === 0) return null
          return (
            <section className="open-work__group" key={group}>
              <h2>
                {labels[group]} · {groupItems.length}
              </h2>
              <ul>
                {groupItems.map((item) => (
                  <WorkRow
                    key={item.copyId}
                    item={item}
                    onRecord={onRecord}
                    selected={item.copyId === selectedId}
                    onRead={() => {
                      onOpen(item)
                    }}
                  />
                ))}
              </ul>
            </section>
          )
        },
      )}
    </div>
  )
}

function SelectedReader({
  item,
  message,
  loading,
  onClose,
  onRecord,
}: Readonly<{
  item: OpenWorkItem | undefined
  message: WorkMessageRead | undefined
  loading: boolean
  onClose: () => void
  onRecord: Props['onRecord']
}>) {
  if (!item) return null
  if (!message)
    return (
      <aside className="open-work__reader">
        {loading ? 'Reading selected thread…' : 'Selected thread unavailable.'}
      </aside>
    )
  return (
    <OpenWorkReader
      key={item.copyId}
      item={item}
      message={message}
      onClose={onClose}
      onRecord={onRecord}
    />
  )
}

/** Recorded work, deliberately counted apart from unread and Inbox totals. */
export function OpenWorkPage({ mode, reading, loading, onRefresh, onRecord, onRead }: Props) {
  const [selectedId, setSelectedId] = useState<string>()
  const [message, setMessage] = useState<WorkMessageRead>()
  const [readingMessage, setReadingMessage] = useState(false)
  const sequence = useRef(0)
  const page = useRef<HTMLElement>(null)
  const open = (item: OpenWorkItem) => {
    const current = ++sequence.current
    setSelectedId(item.copyId)
    setMessage(undefined)
    setReadingMessage(true)
    if (window.matchMedia('(max-width: 600px)').matches) page.current?.scrollTo({ top: 0 })
    void onRead(item.copy)
      .catch(() => ({ status: 'unavailable' }) as const)
      .then((result) => {
        if (current === sequence.current) setMessage(result)
      })
      .finally(() => {
        if (current === sequence.current) setReadingMessage(false)
      })
  }
  const visible = reading.status === 'ready' ? visibleIn(reading.items, mode) : []
  const selected = visible.find((item) => item.copyId === selectedId)
  if (reading.status === 'unavailable')
    return (
      <section className="open-work">
        <h1>{headings[mode]}</h1>
        <p>Local work could not be read.</p>
        <Button type="button" variant="secondary" onClick={onRefresh}>
          Try again
        </Button>
      </section>
    )
  return (
    <section ref={page} className="open-work" aria-label={headings[mode]}>
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
        {reading.tally.open} open · {reading.tally.overdue} overdue · {reading.tally.completed}{' '}
        completed · {reading.tally.unknown} unknown · {reading.tally.conflicts} conflicts
      </p>
      <p className="open-work__verification">
        Checked {new Date(reading.checkedAt).toLocaleString()}
        {reading.bounded ? ' · Record capped at 200 copies' : ''}. Each Spark check is bounded;
        unknown means no current proof.
      </p>
      {visible.length === 0 && <p className="open-work__empty">{emptyMessages[mode]}</p>}
      <div className="open-work__columns">
        <WorkGroups
          items={reading.items}
          mode={mode}
          onRecord={onRecord}
          onOpen={open}
          selectedId={selectedId}
        />
        <SelectedReader
          item={selected}
          message={message}
          loading={readingMessage}
          onClose={() => {
            sequence.current++
            setSelectedId(undefined)
          }}
          onRecord={onRecord}
        />
      </div>
    </section>
  )
}
