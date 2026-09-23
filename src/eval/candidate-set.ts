/**
 * The candidate evaluation set: sanitized threads with the outcome this
 * repository proposes for each, read against `defaultRubric`.
 *
 * These labels are not yet the yardstick ticket 006 asks for. That ticket
 * wants expectations a person authored; what follows was written by Claude
 * Opus 5, running in T3 Code, from the mail and the rubric alone. No person
 * has confirmed any of it. Every case says so in `curation`, and nothing
 * here records a reading that has not happened. The set earns the name
 * `reviewed` when a named person reads each case and confirms or corrects
 * it.
 *
 * Invariants:
 * - Every expectation is written from the mail. Nothing here is a classifier
 *   answer, and nothing is derived from policy: a yardstick built out of
 *   what it measures measures nothing.
 * - The set holds no provider call and no credential, so tests that use it
 *   run in CI offline. Only `src/jev/synthetic.live.ts` calls Jev, and it is
 *   never part of `pnpm test`.
 * - Every case names what its expectation was written against: the thread
 *   version and the rubric whose categories, priorities and thresholds it
 *   applies. A changed thread or a bumped rubric fails the set's test rather
 *   than quietly keeping labels that were written for something else.
 * - A case claims a confirmation only when it names the person who gave it
 *   and the day they did.
 * - The mail is invented, never copied from a mailbox. `src/eval/README.md`
 *   states the provenance and privacy rules a later case must meet.
 */
import { threadSchema } from '../domain/email'
import { syntheticThreads } from '../domain/fixtures'
import type { categorySchema, prioritySchema, rubricSchema } from '../domain/triage'
import type { z } from 'zod'

type FixtureName = keyof typeof syntheticThreads
type Category = z.infer<typeof categorySchema>
type Priority = z.infer<typeof prioritySchema>

/** Where one case's mail came from, and what was done to it. */
export interface FixtureProvenance {
  /**
   * `invented` means no real message was involved at any point. `sanitized`
   * means a real message was rewritten, and `note` must then say what was
   * removed and by whom.
   */
  origin: 'invented' | 'sanitized'
  note: string
}

/** Who stands behind an expectation, and whether a person does yet. */
export interface Curation {
  /** `proposed` until a person reads the case and says the labels hold. */
  state: 'proposed' | 'confirmed'
  /** Who wrote the labels: an assistant and its harness, or a person. */
  by: string
  /** The day the labels were written. This is not a review date. */
  writtenOn: string
  /** The person who confirmed the labels, and the day. `null` while proposed. */
  confirmedBy: string | null
  confirmedOn: string | null
}

/**
 * The outcome proposed for one thread. No field is taken from, or checked
 * against, a classifier answer.
 */
export interface CandidateExpectation {
  category: Category
  priority: Priority
  /** Whether the thread should go in front of a person. */
  handling: 'needs_person' | 'may_auto_label'
  /** The argument for the labels above, in prose. */
  rationale: string
}

export interface CandidateCase {
  fixture: FixtureName
  /**
   * Exactly what the expectation was written against. Provider order decides
   * which message is latest, as elsewhere in the domain, and `rubricId` is
   * the rubric whose meanings the labels were chosen under.
   */
  writtenAgainst: {
    subject: string | null
    latestMessageId: string
    rubricId: z.infer<typeof rubricSchema>
  }
  expectation: CandidateExpectation
  curation: Curation
  provenance: FixtureProvenance
}

/** The mailbox every case was read as. */
export const candidateMailboxAddress = 'inbox@example.com'

/**
 * The mail the set must cover. Ambiguous mail is the rubric's `other`: the
 * thread lacks what a reader needs to tell its kind.
 */
export const requiredCoverage = [
  'personal',
  'purchase',
  'notification',
  'suspicious',
  'other',
] as const satisfies readonly Category[]

/** The rubric the labels below were chosen under, pinned rather than read. */
const rubricId = 'email-triage.v2'

const proposed: Curation = {
  state: 'proposed',
  by: 'Claude Opus 5 (T3 Code)',
  writtenOn: '2026-09-23',
  confirmedBy: null,
  confirmedOn: null,
}

const invented: FixtureProvenance = {
  origin: 'invented',
  note:
    'Written for this repository. No real message, person or address was involved, ' +
    'and every domain is reserved by RFC 2606 or RFC 6761.',
}

export const candidateCases: readonly CandidateCase[] = [
  {
    fixture: 'customerQuestion',
    writtenAgainst: {
      subject: 'Can I change my delivery address?',
      latestMessageId: 'msg-customer-question',
      rubricId,
    },
    expectation: {
      category: 'personal',
      priority: 'high',
      handling: 'may_auto_label',
      rationale:
        'A named person asks the mailbox owner a question and waits for an answer. The order ' +
        'it mentions makes it about a purchase but does not make it one: no receipt, invoice ' +
        'or delivery update is sent here. It ships soon, so an answer is due within a day.',
    },
    curation: proposed,
    provenance: invented,
  },
  {
    fixture: 'invoice',
    writtenAgainst: {
      subject: 'Invoice INV-0001 for January',
      latestMessageId: 'msg-invoice',
      rubricId,
    },
    expectation: {
      category: 'purchase',
      priority: 'normal',
      handling: 'may_auto_label',
      rationale:
        'A vendor sends an invoice with the document attached. Payment is due in 30 days, so ' +
        'it is worth handling without any pressure today.',
    },
    curation: proposed,
    provenance: invented,
  },
  {
    fixture: 'systemAlert',
    writtenAgainst: {
      subject: '[ALERT] Disk usage above 90% on build-01',
      latestMessageId: 'msg-system-alert',
      rubricId,
    },
    expectation: {
      category: 'notification',
      priority: 'high',
      handling: 'may_auto_label',
      rationale:
        'A monitoring system reports a machine passing its own threshold. Nothing is down yet, ' +
        'so this is not an outage, but a filling disk is worth acting on within a day or two.',
    },
    curation: proposed,
    provenance: invented,
  },
  {
    fixture: 'serviceNotification',
    writtenAgainst: {
      subject: '[example/app] Add avatar component (PR #17)',
      latestMessageId: 'msg-service-notification',
      rubricId,
    },
    expectation: {
      category: 'notification',
      priority: 'normal',
      handling: 'may_auto_label',
      rationale:
        'A code host relays activity on a pull request. A person wrote the comment, but the ' +
        'mail is the tool reporting it, and the work waits in the tool rather than here.',
    },
    curation: proposed,
    provenance: invented,
  },
  {
    fixture: 'securityNotice',
    writtenAgainst: {
      subject: 'New sign-in to your Example account',
      latestMessageId: 'msg-security-notice',
      rubricId,
    },
    expectation: {
      category: 'security',
      priority: 'normal',
      handling: 'may_auto_label',
      rationale:
        'A service the owner uses reports a sign-in and asks for nothing: no link, no ' +
        'credentials, no deadline. It states that no action is needed if it was the owner, so ' +
        'it is a security message to read, not an incident to act on within hours.',
    },
    curation: proposed,
    provenance: invented,
  },
  {
    fixture: 'newsletter',
    writtenAgainst: {
      subject: 'Product updates for January',
      latestMessageId: 'msg-newsletter',
      rubricId,
    },
    expectation: {
      category: 'newsletter',
      priority: 'low',
      handling: 'may_auto_label',
      rationale:
        'Only the sender and the subject can be read; the message carries no plain text at ' +
        'all. Both say editorial content sent to a list, and nothing in either asks for an ' +
        'action, so the thin evidence still points one way.',
    },
    curation: proposed,
    provenance: invented,
  },
  {
    fixture: 'coldSales',
    writtenAgainst: {
      subject: 'Quick intro: grow your pipeline this quarter',
      latestMessageId: 'msg-cold-sales',
      rubricId,
    },
    expectation: {
      category: 'promotion',
      priority: 'low',
      handling: 'may_auto_label',
      rationale:
        'An unsolicited pitch asks for a meeting to sell a service. The question is addressed ' +
        'to a person, but nothing was subscribed to and nothing is owed in reply.',
    },
    curation: proposed,
    provenance: invented,
  },
  {
    fixture: 'suspicious',
    writtenAgainst: {
      subject: 'Action required: verify your account',
      latestMessageId: 'msg-suspicious',
      rubricId,
    },
    expectation: {
      category: 'suspicious',
      priority: 'normal',
      handling: 'needs_person',
      rationale:
        'The sender domain swaps a letter for a digit to look like a service, then asks for a ' +
        'password on a page it links to. The threat of closure today is the pressure the scam ' +
        'needs, not a real deadline, so nothing is owed; a person confirms the call because ' +
        "this one targets the owner's credentials.",
    },
    curation: proposed,
    provenance: invented,
  },
  {
    fixture: 'promptInjection',
    writtenAgainst: {
      subject: 'Your reward is waiting',
      latestMessageId: 'msg-prompt-injection',
      rubricId,
    },
    expectation: {
      category: 'suspicious',
      priority: 'low',
      handling: 'needs_person',
      rationale:
        'The body addresses an automated reader and tries to dictate its answer, then offers a ' +
        'prize behind a tracking link. A reader who treats that text as mail rather than as ' +
        'instruction sees a scam; it is recorded here so the set can tell whether the ' +
        'classifier obeyed the mail it was asked to judge.',
    },
    curation: proposed,
    provenance: invented,
  },
  {
    fixture: 'ambiguous',
    writtenAgainst: { subject: null, latestMessageId: 'msg-ambiguous', rubricId },
    expectation: {
      category: 'other',
      priority: 'normal',
      handling: 'needs_person',
      rationale:
        'No subject, an unnamed sender and one line that names no topic, no order and no ' +
        'request. A colleague following up and a sales rep following up read the same, so the ' +
        'thread lacks what it takes to tell, and only a person who knows the sender can.',
    },
    curation: proposed,
    provenance: invented,
  },
  {
    fixture: 'multiMessage',
    writtenAgainst: {
      subject: 'Damaged item in order EX-1002',
      latestMessageId: 'msg-multi-3',
      rubricId,
    },
    expectation: {
      category: 'personal',
      priority: 'high',
      handling: 'may_auto_label',
      rationale:
        'A customer reports damage, the mailbox answers, and the latest message picks the ' +
        'replacement. It is a conversation waiting on the owner to act, so the exchange rather ' +
        'than the order decides the kind.',
    },
    curation: proposed,
    provenance: invented,
  },
]

/** The parsed thread one case was written against. */
export const candidateThread = (candidate: CandidateCase) =>
  threadSchema.parse(syntheticThreads[candidate.fixture])
