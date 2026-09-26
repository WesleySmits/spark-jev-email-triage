/**
 * How the workbench offers the handling step for one open row, and what it
 * says a recorded decision changed.
 *
 * Plain functions of plain data, like `action.ts` beside it. Nothing here
 * records a decision, proposes an action, reads a store or reaches a
 * provider: it owns the words, and the container owns the state.
 *
 * What the copy must never do, and the reason this module owns it:
 *
 * - A decision is never shown as a mailbox change. Three of the four
 *   outcomes reach no provider at all, and the fourth only proposes one
 *   guarded Spark Done, which still needs approval, a fresh check, a durable
 *   receipt and a readback.
 * - An attempt that did not settle never reads as finished. A blocked,
 *   uncertain or lapsed Done leaves the work explicitly open, and an
 *   uncertain one says the mailbox may have changed anyway.
 * - A later message never makes an old decision current. Every decision,
 *   including the three that reach no provider, is about one mailbox copy
 *   and one thread version; once the reading moves that version on, the
 *   decision reads as out of date and the work as open, and only a person
 *   deciding again replaces it. Nothing is retargeted quietly.
 * - Nothing claims a decision was stored. There is no store for a work
 *   status yet, so the copy says a decision is kept while the message stays
 *   open and no longer.
 * - No link into Spark is offered. Opening one exact message there is
 *   unproven, and `spark/message-link.ts` records why.
 */
import type { DoneExecutionResult } from '../../../app/done-action'
import { handlingOutcomes, type HandlingOutcome } from '../../../domain/handling'
import type { ActionStanding, TargetStanding } from '../../../domain/mailbox-action'
import type { HandlingOptionView } from '../../organisms/HandlingPanel/HandlingPanel'
import { blockedText } from './action'

/** Whether this page could start the guarded Done path at all. */
export type DoneOffer = 'available' | 'not_connected'

const unchanged = 'Your mailbox is unchanged.'

const labels = {
  handle_now: 'Handle now',
  reply_needed: 'Reply needed',
  follow_up_later: 'Follow up later',
  read_only: 'Read only',
} as const satisfies Record<HandlingOutcome, string>

/** What each outcome that stays in this app changes, in its own words. */
const localEffects = {
  reply_needed: 'Keeps the work open here. The mail stays in your Inbox.',
  follow_up_later: 'Keeps the work open here. Nothing is scheduled with Spark.',
  read_only: 'No work owed. The mail stays where it is.',
} as const satisfies Record<Exclude<HandlingOutcome, 'handle_now'>, string>

const doneEffects = {
  available:
    'Proposes one guarded Spark Done for this message ID. Approval, a fresh check and a readback still follow.',
  not_connected: 'Not available here: no Spark action path is connected, so nothing is proposed.',
} as const satisfies Record<DoneOffer, string>

const effectOfOption = (outcome: HandlingOutcome, done: DoneOffer) =>
  outcome === 'handle_now' ? doneEffects[done] : localEffects[outcome]

/**
 * The four outcomes as the panel offers them. An outcome that cannot be
 * recorded is offered and refused in words rather than hidden: its effect
 * line says why, so nobody is left looking for a choice that is not there.
 *
 * `versioned` is false where the reading names no exact version for the row.
 * A decision is about one version, so none of the four can be recorded then.
 */
export function handlingOptions(
  done: DoneOffer,
  versioned: boolean,
): readonly HandlingOptionView[] {
  return handlingOutcomes.map((outcome) => ({
    value: outcome,
    label: labels[outcome],
    effect: effectOfOption(outcome, done),
    disabled: !versioned || (outcome === 'handle_now' && done !== 'available'),
  }))
}

/** One of the four outcomes, or nothing where a value names none of them. */
export const asOutcome = (value: string): HandlingOutcome | null =>
  handlingOutcomes.find((outcome) => outcome === value) ?? null

export const handlingTitle = 'What happens next?'

export const handlingSummary =
  'Choose the work owed for this exact message version. Recording a choice moves no mail.'

/**
 * What recording changes and what it does not, including the two things a
 * person cannot see for themselves: that Spark acts on the message ID rather
 * than on the row, and that nothing here is stored.
 */
export function handlingNote(messageId: string | undefined): string {
  if (messageId === undefined) {
    return `This reading does not name an exact version for this message, so no decision can be recorded against it. ${unchanged}`
  }
  return `Reply needed, Follow up later and Read only record work in this app only: no Spark command is sent and the mail stays in your Inbox. Handle now proposes one guarded Spark Done for message ID ${messageId}; Spark acts on that ID, so another copy carrying it may change too. Nothing is stored yet, so a decision is kept only while this message stays open, and no link that opens this exact message in Spark has been proven.`
}

/**
 * What the panel changes, as words rather than colour, before anyone decided.
 * Once a decision is recorded its own tags replace these, because "Spark
 * unchanged" stops being true the moment an attempt may have reached Spark.
 */
const undecidedTags = ['Decision', 'Local work status', 'Spark unchanged'] as const

/** The tags that belong to where a decision stands now. */
export const handlingTags = (view: RecordedView | null): readonly string[] =>
  view?.tags ?? undecidedTags

/** The result copy beside the record button, while nothing is recorded. */
export function handlingResult(versioned: boolean): Readonly<{ title: string; detail: string }> {
  if (!versioned) {
    return {
      title: 'Nothing to decide against',
      detail: `A decision names one mailbox copy and the thread version shown. ${unchanged}`,
    }
  }
  return {
    title: 'Nothing recorded',
    detail: `Recording keeps a work status in this app. Only a separate guarded Done reaches Spark. ${unchanged}`,
  }
}

type DecisionTone = 'neutral' | 'review' | 'done' | 'danger'

/** A recorded decision and where it stands, with nothing left implicit. */
export type RecordedView = Readonly<{
  title: string
  detail: string
  state: Readonly<{ label: string; tone: DecisionTone }>
  /** What this decision changed, as words. Never claims more than it proved. */
  tags: readonly string[]
  /** Whether this decision may still be taken back here. */
  locked: boolean
}>

const localRecorded = (outcome: Exclude<HandlingOutcome, 'handle_now'>): RecordedView => ({
  title: labels[outcome],
  detail: `Recorded in this app only. The mail stays in your Spark Inbox, and nothing was stored: this decision is kept while the message stays open. ${unchanged}`,
  state: { label: 'Local work status', tone: 'review' },
  tags: ['Decision', 'Local work status', 'Spark unchanged'],
  locked: false,
})

const lockedNote = 'This attempt is locked, so the decision cannot be changed here.'

const movedOn = {
  newer_message: 'A later message has reached this thread since you decided.',
  other_thread: 'This copy now belongs to another thread than the one you decided about.',
} as const

/**
 * A decision about a version this row has moved past. It is shown as what it
 * is — out of date, with the work still open — and never quietly moved onto
 * the version that replaced it. Nothing was sent to Spark for it: a decision
 * whose attempt may have reached the provider is answered before this.
 */
const outOfDate = (outcome: HandlingOutcome, reason: keyof typeof movedOn): RecordedView => ({
  title: labels[outcome],
  detail: `${movedOn[reason]} This decision is about the version before it, so it no longer describes this message. The work stays open: decide again against the version that holds now. ${unchanged}`,
  state: { label: 'Out of date', tone: 'danger' },
  tags: [
    'Decision',
    outcome === 'handle_now' ? 'Nothing sent to Spark' : 'Spark unchanged',
    'Work still open',
  ],
  locked: false,
})

/** Where one recorded Handle now stands once Spark was asked, or refused. */
function executedRecorded(result: DoneExecutionResult): RecordedView {
  if (result.status === 'confirmed') {
    return {
      title: labels.handle_now,
      detail: `Spark Done was read back in Archive and absent from Inbox. ${lockedNote}`,
      state: { label: 'Done confirmed', tone: 'done' },
      tags: ['Decision', 'Spark Done confirmed by readback'],
      locked: true,
    }
  }
  if (result.status === 'uncertain') {
    return {
      title: labels.handle_now,
      detail: `Spark may have changed this message, and it may not. The work stays open until you check Spark yourself; no automatic retry is allowed. ${lockedNote}`,
      state: { label: 'Still open, unresolved', tone: 'danger' },
      // Never "Spark unchanged": an uncertain attempt may have reached it.
      tags: ['Decision', 'Spark may have changed', 'Work still open'],
      locked: true,
    }
  }
  return {
    title: labels.handle_now,
    detail: `${blockedText(result.reason)} No Spark action was sent, so the work stays open.`,
    state: { label: 'Still open', tone: 'danger' },
    tags: ['Decision', 'No Spark action sent', 'Work still open'],
    locked: false,
  }
}

/** Where one recorded Handle now stands before anything was sent to Spark. */
function proposedRecorded(standing: ActionStanding | null): RecordedView {
  if (standing?.stage === 'approved') {
    return {
      title: labels.handle_now,
      detail: `You approved this proposal. Spark Done still needs the separate confirmation below, and nothing has been sent. ${unchanged}`,
      state: { label: 'Approved, not run', tone: 'review' },
      tags: ['Decision', 'Guarded Done approved', 'Spark unchanged so far'],
      locked: false,
    }
  }
  return {
    title: labels.handle_now,
    detail: `One guarded Spark Done is proposed below for the selected message ID. Approval and a confirmed readback both still have to happen. ${unchanged}`,
    state: { label: 'Proposed, not run', tone: 'review' },
    tags: ['Decision', 'Guarded Done proposed', 'Spark unchanged so far'],
    locked: false,
  }
}

/**
 * What one recorded decision amounts to now.
 *
 * `version` is where the copy and thread version the decision named stand in
 * the reading now, as `targetStanding` reports it. A broken one makes the
 * decision out of date whatever it was, because no outcome describes a
 * version the mail has moved past.
 *
 * Provider evidence is answered first and is never discarded by a later
 * message: an attempt that was confirmed or left uncertain keeps saying so,
 * and keeps its lock, because what Spark may already have done does not stop
 * being true when the thread moves on.
 */
export function recordedDecision(
  outcome: HandlingOutcome,
  version: TargetStanding,
  standing: ActionStanding | null,
  execution: DoneExecutionResult | null,
): RecordedView {
  if (execution !== null) return executedRecorded(execution)
  if (version.status === 'broken') return outOfDate(outcome, version.reason)
  if (outcome !== 'handle_now') return localRecorded(outcome)
  return proposedRecorded(standing)
}

/** What one recorded decision amounts to, in one line. */
const handlingAnnouncement = (view: RecordedView) =>
  `${view.title}. ${view.state.label}. ${view.detail}`

const clearedAnnouncement = `Decision cleared. Nothing is recorded, proposed, approved or carried out. ${unchanged}`

/**
 * What a polite live region says now: where a recorded decision stands, that
 * the last one was taken back, or nothing at all before anyone decided.
 */
export function handlingStatus(view: RecordedView | null, cleared: boolean): string {
  if (view !== null) return handlingAnnouncement(view)
  return cleared ? clearedAnnouncement : ''
}
