import type {
  WorkDecisionRequest,
  WorkDecisionResult,
  WorkMessageRead,
} from '../../../app/open-work'
import type { OpenWorkItem } from '../../../domain/open-work'
import { Button } from '../../atoms/Button/Button'
import { OpenWorkDecisionForm } from './OpenWorkDecisionForm'

type Props = Readonly<{
  item: OpenWorkItem
  message: WorkMessageRead
  onClose: () => void
  onRecord: (request: WorkDecisionRequest) => Promise<WorkDecisionResult>
}>

/** The selected thread is read on demand and held only in this browser view. */
export function OpenWorkReader({ item, message, onClose, onRecord }: Props) {
  if (message.status === 'unavailable')
    return (
      <aside className="open-work__reader">
        <Button type="button" variant="quiet" onClick={onClose}>
          Close reader
        </Button>
        <p className="open-work__alert" role="alert">
          This recorded copy could not be read in Spark. Check Spark and try again.
        </p>
      </aside>
    )
  const previous = item.history[0]
  const moved =
    previous?.target.threadId !== message.target.threadId ||
    previous.target.latestMessageId !== message.target.latestMessageId
  return (
    <aside className="open-work__reader" aria-label="Selected work message">
      <Button type="button" variant="quiet" onClick={onClose}>
        Close reader
      </Button>
      <h2>{message.subject ?? '(No subject)'}</h2>
      <p className="open-work__meta">
        {item.copy.mailboxId} · {item.copy.messageId}
      </p>
      {moved && (
        <p className="open-work__alert" role="alert">
          The previous decision belongs to an older thread version. The controls below name the
          version just read.
        </p>
      )}
      {message.messages.map((part) => (
        <article key={part.id}>
          <h3>{part.sender}</h3>
          <p className="open-work__meta">
            {part.sentAt ? new Date(part.sentAt).toLocaleString() : 'Time unavailable'}
          </p>
          <p className="open-work__body">{part.text ?? 'No plain-text body available.'}</p>
        </article>
      ))}
      <OpenWorkDecisionForm
        target={message.target}
        canReopen={previous?.kind === 'handled_in_spark'}
        onRecord={onRecord}
      />
      <p className="open-work__verification">
        Reading this thread and recording a decision do not send a Spark write command. A save
        checks this version again.
      </p>
    </aside>
  )
}
