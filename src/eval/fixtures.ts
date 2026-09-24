/**
 * Invented mail used only by the reviewed evaluation set.
 *
 * The general domain fixtures remain small and reusable. Feature-specific
 * coverage lives here, beside its labels, and uses only reserved domains.
 */
import type { z } from 'zod'
import type { threadSchema } from '../domain/email'
import { syntheticMailValues, syntheticThreads } from '../domain/fixtures'

type ThreadInput = z.input<typeof threadSchema>
type MessageInput = ThreadInput['messages'][number]
type ParticipantInput = MessageInput['from']

const message = (
  id: string,
  from: ParticipantInput,
  sentAt: string | null,
  bodyText: string | null,
  extra: Partial<MessageInput> = {},
): MessageInput => {
  const emptyMessage = { id, from, sentAt, bodyText, to: [], cc: [], attachments: [] }
  return { ...emptyMessage, ...extra }
}

const thread = (
  id: string,
  subject: string | null,
  messages: MessageInput[],
  mailboxId = 'mailbox-example',
): ThreadInput => ({ id, mailboxId, subject, messages })

const inbox: ParticipantInput = { address: 'inbox@example.com', name: 'Example Support' }

export const featureEightThreads = {
  personalDinner: thread('thread-personal-dinner', 'Dinner next Thursday?', [
    message(
      'msg-personal-dinner',
      { address: 'friend@example.net', name: 'Example Friend' },
      '2026-02-02T18:20:00+01:00',
      'Would you like to have dinner next Thursday? Let me know whenever you have checked your calendar.',
      { to: [inbox] },
    ),
  ]),
  invoiceDueToday: thread('thread-invoice-due-today', 'Invoice EX-204 is due today', [
    message(
      'msg-invoice-due-today',
      { address: 'billing@studio.example', name: 'Example Studio Billing' },
      '2026-02-03T07:10:00Z',
      'Invoice EX-204 is attached and payment is due today under the agreed terms.',
      {
        to: [inbox],
        attachments: [{ filename: 'EX-204.pdf', mediaType: 'application/pdf', sizeBytes: 39120 }],
      },
    ),
  ]),
  securityIncident: thread('thread-security-incident', 'Password changed without confirmation', [
    message(
      'msg-security-incident',
      { address: 'no-reply@accounts.example', name: 'Example Accounts' },
      '2026-02-03T06:15:00Z',
      'Your password was changed. You told us this was not you, so access has been suspended. Review the activity in account settings now.',
      { to: [inbox] },
    ),
  ]),
  subscribedNewsletter: thread('thread-subscribed-newsletter', 'February field notes', [
    message(
      'msg-subscribed-newsletter',
      { address: 'notes@publication.example', name: 'Example Field Notes' },
      '2026-02-01T07:00:00Z',
      'You are receiving the monthly field notes you subscribed to. This edition covers winter gardens. Manage your subscription in your profile.',
      { to: [inbox] },
    ),
  ]),
  aliasNoticePersonal: thread(
    'thread-alias-notice-personal',
    'Planned maintenance on Saturday',
    [
      message(
        'msg-alias-notice',
        { address: 'status@service.example', name: 'Example Service' },
        '2026-02-02T08:00:00Z',
        'We pause the service on Saturday between 02:00 and 04:00 UTC. No action is required.',
        { to: [inbox] },
      ),
    ],
    'mailbox-personal',
  ),
  aliasNoticeTeam: thread(
    'thread-alias-notice-team',
    'Planned maintenance on Saturday',
    [
      message(
        'msg-alias-notice',
        { address: 'status@service.example', name: 'Example Service' },
        '2026-02-02T08:00:00Z',
        'We pause the service on Saturday between 02:00 and 04:00 UTC. No action is required.',
        { to: [inbox] },
      ),
    ],
    'mailbox-shared',
  ),
  uncertainPriority: thread('thread-uncertain-priority', 'Could you review this when possible?', [
    message(
      'msg-uncertain-priority',
      { address: 'colleague@example.org', name: 'Example Colleague' },
      '2026-02-02T10:00:00Z',
      'Could you review the attached draft when possible? There is no fixed deadline, but this week would be useful.',
      {
        to: [inbox],
        attachments: [{ filename: 'draft.txt', mediaType: 'text/plain', sizeBytes: 2048 }],
      },
    ),
  ]),
} satisfies Record<string, ThreadInput>

export const evaluationThreads = {
  ...syntheticThreads,
  ...featureEightThreads,
} satisfies Record<string, ThreadInput>

/** Mail-derived values that must stay out of reports and snapshots. */
const featureEightMailValues = Object.values(featureEightThreads)
  .flatMap((evaluated) => [
    evaluated.subject,
    ...evaluated.messages.flatMap((item) => [
      item.bodyText,
      ...[item.from, ...item.to, ...item.cc].flatMap(({ address, name }) => [address, name]),
      ...item.attachments.map(({ filename }) => filename),
    ]),
  ])
  .filter((value): value is string => value !== null && value !== '')

export const evaluationMailValues: readonly string[] = [
  ...syntheticMailValues,
  ...featureEightMailValues,
]
