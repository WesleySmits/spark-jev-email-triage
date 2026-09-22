/**
 * The immutable version of a thread that a classifier is asked to judge.
 *
 * Spark exposes no stable thread id: `spark thread` prints a summary and one
 * block per message, and nothing in that output names the thread. The adapter
 * therefore derives a thread id from the first message the provider returned,
 * which makes the id provider-local twice over. It means nothing outside the
 * mailbox the thread was read from, and it changes as soon as the provider
 * stops returning that first message. A thread snapshot records what was
 * actually observed: the mailbox copy that was read, the messages the
 * provider returned for it, and when. A classification subject freezes one
 * snapshot together with the rubric and classifier version that judged it, so
 * a later classification can name the exact version it refers to.
 *
 * Invariants:
 * - A snapshot names the mailbox copy it was read from. Its thread belongs to
 *   that mailbox and contains that copy's message.
 * - A snapshot's thread id is its first message id, checked here rather than
 *   trusted, because the provider never states it.
 * - A subject's latest message is the last message of its snapshot in the
 *   order the provider returned. Sent times can be missing or wrong, so
 *   provider order decides.
 * - Identity never comes from content. Two snapshots with identical text in
 *   two mailboxes stay two subjects; see `mailboxCopyId`.
 * - Nothing here infers a logical message or a delivery from these copies.
 */
import { z } from 'zod'
import { threadSchema } from './email'
import { mailboxCopyRefSchema } from './mailbox-copy'
import { rubricSchema } from './triage'

const id = threadSchema.shape.id

/**
 * The classifier build that was asked. Moving aliases such as `jev-latest`
 * would let a different classifier hide behind a stored subject, so a subject
 * names a pinned version only.
 */
const classifierVersionSchema = id.refine((value) => !/(^|[-./@])latest$/.test(value), {
  message: 'A classifier version must be pinned, not a moving alias',
})

export const threadSnapshotSchema = z
  .strictObject({
    /** The mailbox copy the application read to obtain this thread. */
    copy: mailboxCopyRefSchema,
    /** The messages the provider returned, in the order it returned them. */
    thread: threadSchema,
    /** When the application read the copy, not a provider timestamp. */
    observedAt: z.iso.datetime({ offset: true }),
  })
  .refine(({ copy, thread }) => thread.mailboxId === copy.mailboxId, {
    message: 'A snapshot thread must belong to the mailbox its copy was read from',
    path: ['thread', 'mailboxId'],
  })
  .refine(({ thread }) => thread.id === thread.messages[0]?.id, {
    message: 'A snapshot thread id must be the id of its first message',
    path: ['thread', 'id'],
  })
  .refine(({ copy, thread }) => thread.messages.some(({ id: each }) => each === copy.messageId), {
    message: 'A snapshot must contain the message of the copy it was read from',
    path: ['copy', 'messageId'],
  })

export const classificationSubjectSchema = z
  .strictObject({
    /** The snapshot version being judged, including the mailbox copy. */
    snapshot: threadSnapshotSchema,
    /** The snapshot's last message, named so a stale subject cannot parse. */
    latestMessageId: id,
    /** The rubric version whose categories and policy the classifier applies. */
    rubric: rubricSchema,
    classifierVersion: classifierVersionSchema,
  })
  .refine(
    ({ snapshot, latestMessageId }) => snapshot.thread.messages.at(-1)?.id === latestMessageId,
    {
      message: 'A subject must name the latest message of its snapshot',
      path: ['latestMessageId'],
    },
  )

export type ThreadSnapshot = z.infer<typeof threadSnapshotSchema>
export type ClassificationSubject = z.infer<typeof classificationSubjectSchema>

interface Judge {
  rubric: ClassificationSubject['rubric']
  classifierVersion: string
}

/**
 * The subject for one snapshot, as judged by `judge`. The latest message is
 * the last one the provider returned, because sent times can be missing.
 */
export const classificationSubjectFor = (snapshot: ThreadSnapshot, judge: Judge) =>
  classificationSubjectSchema.parse({
    snapshot,
    latestMessageId: snapshot.thread.messages.at(-1)?.id,
    ...judge,
  })
