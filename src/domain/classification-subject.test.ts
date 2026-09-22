import { describe, expect, it } from 'vitest'
import type { z } from 'zod'
import {
  classificationSubjectFor,
  classificationSubjectSchema,
  threadSnapshotSchema,
  type ClassificationSubject,
} from './classification-subject'
import { independentlyObservedCopies } from './fixtures'
import { mailboxCopyId } from './mailbox-copy'
import { currentTriageRubric } from './triage'

type SnapshotInput = z.input<typeof threadSnapshotSchema>
type SubjectInput = z.input<typeof classificationSubjectSchema>
type ThreadInput = SnapshotInput['thread']
type MessageInput = ThreadInput['messages'][number]

const message = (id: string, bodyText: string | null = 'Hello'): MessageInput => ({
  id,
  from: { address: 'sender@example.com', name: null },
  to: [{ address: 'inbox@example.com', name: null }],
  cc: [],
  sentAt: '2026-01-05T09:00:00Z',
  bodyText,
  attachments: [],
})

const thread = (overrides: Partial<ThreadInput> = {}): ThreadInput => ({
  id: 'msg-1',
  mailboxId: 'mailbox-1',
  subject: 'Subject',
  messages: [message('msg-1'), message('msg-2')],
  ...overrides,
})

const snapshot = (overrides: Partial<SnapshotInput> = {}): SnapshotInput => ({
  copy: { mailboxId: 'mailbox-1', messageId: 'msg-1' },
  thread: thread(),
  observedAt: '2026-01-05T09:30:00Z',
  ...overrides,
})

const subject = (overrides: Partial<SubjectInput> = {}): SubjectInput => ({
  snapshot: snapshot(),
  latestMessageId: 'msg-2',
  rubric: currentTriageRubric,
  classifierVersion: 'jev-1.13.0',
  ...overrides,
})

const without = (value: object, key: string) =>
  Object.fromEntries(Object.entries(value).filter(([each]) => each !== key))

const issuePaths = (result: { error?: z.ZodError | undefined }) =>
  result.error?.issues.map((issue) => issue.path.join('.')) ?? []

describe('threadSnapshotSchema', () => {
  it('accepts a thread read from the mailbox copy it names', () => {
    expect(threadSnapshotSchema.safeParse(snapshot()).success).toBe(true)
  })

  it('rejects a thread read from another mailbox than the copy', () => {
    const result = threadSnapshotSchema.safeParse(
      snapshot({ copy: { mailboxId: 'mailbox-2', messageId: 'msg-1' } }),
    )

    expect(issuePaths(result)).toContain('thread.mailboxId')
  })

  it('rejects a thread id the provider did not derive from the first message', () => {
    const result = threadSnapshotSchema.safeParse(snapshot({ thread: thread({ id: 'msg-2' }) }))

    expect(issuePaths(result)).toContain('thread.id')
  })

  it('rejects a snapshot that does not contain the copy it was read from', () => {
    const result = threadSnapshotSchema.safeParse(
      snapshot({ copy: { mailboxId: 'mailbox-1', messageId: 'msg-missing' } }),
    )

    expect(issuePaths(result)).toContain('copy.messageId')
  })

  it.each(['copy', 'thread', 'observedAt'])('rejects a snapshot without %s', (key) => {
    expect(threadSnapshotSchema.safeParse(without(snapshot(), key)).success).toBe(false)
  })

  it('rejects a snapshot carrying anything the domain does not define', () => {
    const result = threadSnapshotSchema.safeParse({ ...snapshot(), contentHash: 'abc123' })

    expect(result.success).toBe(false)
  })

  it('keeps mail content out of its errors', () => {
    const secret = 'Board memo about the acquisition'
    const result = threadSnapshotSchema.safeParse(
      snapshot({
        copy: { mailboxId: 'mailbox-2', messageId: 'msg-1' },
        thread: thread({ subject: secret, messages: [message('msg-1', secret)] }),
      }),
    )

    expect(JSON.stringify(result.error?.issues)).not.toContain('acquisition')
  })
})

describe('classificationSubjectSchema', () => {
  it('accepts a subject naming its copy, latest message, rubric and classifier', () => {
    expect(classificationSubjectSchema.safeParse(subject()).success).toBe(true)
  })

  it('rejects a subject naming a message that is not the snapshot latest', () => {
    const result = classificationSubjectSchema.safeParse(subject({ latestMessageId: 'msg-1' }))

    expect(issuePaths(result)).toContain('latestMessageId')
  })

  it('rejects a subject naming a message outside its snapshot', () => {
    const result = classificationSubjectSchema.safeParse(subject({ latestMessageId: 'msg-9' }))

    expect(issuePaths(result)).toContain('latestMessageId')
  })

  it.each(['snapshot', 'latestMessageId', 'rubric', 'classifierVersion'])(
    'rejects a subject without %s',
    (key) => {
      expect(classificationSubjectSchema.safeParse(without(subject(), key)).success).toBe(false)
    },
  )

  it('rejects a rubric the domain does not know', () => {
    const retired: unknown = { ...subject(), rubric: 'email-triage.v1' }

    expect(classificationSubjectSchema.safeParse(retired).success).toBe(false)
  })

  it.each(['jev-latest', 'latest', 'jev.latest', ''])(
    'rejects the unpinned classifier version %j',
    (classifierVersion) => {
      const result = classificationSubjectSchema.safeParse(subject({ classifierVersion }))

      expect(issuePaths(result)).toContain('classifierVersion')
    },
  )

  it('rejects a subject carrying anything the domain does not define', () => {
    const result = classificationSubjectSchema.safeParse({ ...subject(), threadFingerprint: 'abc' })

    expect(result.success).toBe(false)
  })
})

describe('classificationSubjectFor', () => {
  it('names the last message the provider returned, not the latest sent time', () => {
    const outOfOrder = snapshot({
      thread: thread({
        messages: [
          { ...message('msg-1'), sentAt: '2026-01-05T12:00:00Z' },
          { ...message('msg-2'), sentAt: null },
        ],
      }),
    })

    const built: ClassificationSubject = classificationSubjectFor(
      threadSnapshotSchema.parse(outOfOrder),
      {
        rubric: currentTriageRubric,
        classifierVersion: 'jev-1.13.0',
      },
    )

    expect(built.latestMessageId).toBe('msg-2')
  })
})

describe('independentlyObservedCopies', () => {
  const observed = Object.values(independentlyObservedCopies).map((value) =>
    threadSnapshotSchema.parse(value),
  )

  it('are two copies of one communication, observed separately', () => {
    expect(observed).toHaveLength(2)
    const [first, second] = observed

    expect(first?.observedAt).not.toBe(second?.observedAt)
    expect(first?.thread.messages[0]?.bodyText).toBe(second?.thread.messages[0]?.bodyText)
  })

  it('share a provider message id yet stay separate mailbox copies', () => {
    const [first, second] = observed

    expect(first?.copy.messageId).toBe(second?.copy.messageId)
    expect(first && mailboxCopyId(first.copy)).not.toBe(second && mailboxCopyId(second.copy))
  })

  it('become two subjects that no content match merges', () => {
    const judge = { rubric: currentTriageRubric, classifierVersion: 'jev-1.13.0' }
    const [first, second] = observed.map((value) => classificationSubjectFor(value, judge))

    expect(first?.latestMessageId).toBe(second?.latestMessageId)
    expect(first?.snapshot.copy.mailboxId).not.toBe(second?.snapshot.copy.mailboxId)
  })
})
