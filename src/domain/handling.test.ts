import { describe, expect, it } from 'vitest'
import {
  decideHandling,
  effectOf,
  handlingOutcomes,
  handlingRequest,
  parseHandlingDecision,
  proposesDone,
  type HandlingOutcome,
} from './handling'
import { actionStanding } from './mailbox-action'
import { mailboxCopyId } from './mailbox-copy'

const studio = 'studio@mail.example'
const alias = 'alias@mail.example'

/** Fictional mail. The same provider id is listed in two mailboxes. */
const target = (mailboxId: string) => ({
  copy: { mailboxId, messageId: '11' },
  threadId: 't-11',
  latestMessageId: '11',
})

const judged = {
  copy: { mailboxId: studio, messageId: '11' },
  threadId: 't-11',
  latestMessageId: '11',
  rubric: 'email-triage.v2',
  classifierVersion: 'jev-1.13.0',
}

const decidedAt = '2026-09-26T09:15:00.000Z'

const decide = (outcome: HandlingOutcome, mailboxId = studio) =>
  decideHandling({
    outcome,
    target: target(mailboxId),
    basis: { classification: judged },
    decidedAt,
  })

const localOnly = handlingOutcomes.filter((outcome) => outcome !== 'handle_now')

describe('handling outcomes', () => {
  it('states for every outcome what it changes', () => {
    expect(handlingOutcomes).toEqual(['handle_now', 'reply_needed', 'follow_up_later', 'read_only'])
    expect(effectOf('handle_now')).toBe('work_status_and_done_proposal')
    for (const outcome of localOnly) expect(effectOf(outcome)).toBe('work_status')
  })

  it('lets only handling a message now ask Spark for anything', () => {
    expect(handlingOutcomes.filter(proposesDone)).toEqual(['handle_now'])
  })
})

describe('handlingRequest', () => {
  it('records the work owed on the exact version decided, for every outcome', () => {
    for (const outcome of handlingOutcomes) {
      expect(handlingRequest(decide(outcome)).workStatus).toEqual({
        copy: { mailboxId: studio, messageId: '11' },
        threadId: 't-11',
        latestMessageId: '11',
        outcome,
        recordedAt: decidedAt,
      })
    }
  })

  it('reaches no provider for a reply, a later follow-up or mail that only informs', () => {
    for (const outcome of localOnly) {
      expect(handlingRequest(decide(outcome))).toMatchObject({
        outcome,
        effect: 'work_status',
        proposal: null,
      })
    }
  })

  it('proposes one Spark Done addressed by message id when a person handles it now', () => {
    expect(handlingRequest(decide('handle_now')).proposal).toEqual({
      kind: 'markAsDone',
      scope: 'spark-message-id',
      targets: [target(studio)],
      basis: { classification: judged },
      proposedAt: decidedAt,
    })
  })

  it('keeps the instant it was decided, in UTC, wherever it is carried', () => {
    const request = handlingRequest(
      decideHandling({
        outcome: 'handle_now',
        target: target(studio),
        basis: null,
        decidedAt: '2026-09-26T11:15:00+02:00',
      }),
    )
    expect(request.workStatus.recordedAt).toBe(decidedAt)
    expect(request.proposal?.proposedAt).toBe(decidedAt)
  })

  it('leaves the proposal it made blocked on a person and on the executor', () => {
    const { proposal } = handlingRequest(decide('handle_now'))
    if (proposal === null) throw new Error('handling now proposes an action')
    const standing = actionStanding(proposal, null, [])
    expect(standing.stage).toBe('proposed')
    expect(standing.execution).toEqual({
      status: 'blocked',
      unmet: [
        { name: 'thread_unchanged', ...target(studio) },
        { name: 'human_approval' },
        { name: 'write_adapter_connected' },
      ],
    })
  })

  it('names one copy and never the other copies that share its provider id', () => {
    const fromAlias = handlingRequest(decide('handle_now', alias)).proposal
    const fromStudio = handlingRequest(decide('handle_now', studio)).proposal
    expect(fromAlias?.targets).toEqual([target(alias)])
    expect(fromStudio?.targets).toEqual([target(studio)])
    // Two distinct rows, one provider id: what Spark is asked to act on is
    // the id, so acting on either row can affect the other copy.
    expect(mailboxCopyId(target(alias).copy)).not.toBe(mailboxCopyId(target(studio).copy))
    expect(fromAlias?.targets[0]?.copy.messageId).toBe(fromStudio?.targets[0]?.copy.messageId)
  })
})

describe('parseHandlingDecision', () => {
  const valid: Parameters<typeof decideHandling>[0] = {
    outcome: 'read_only',
    target: target(studio),
    basis: null,
    decidedAt,
  }

  it('accepts a decision about one named version', () => {
    expect(parseHandlingDecision(valid)).toEqual(valid)
  })

  it('refuses anything it cannot read as one exact decision', () => {
    expect(parseHandlingDecision({ ...valid, outcome: 'archive' })).toBeNull()
    expect(parseHandlingDecision({ ...valid, decidedAt: 'yesterday' })).toBeNull()
    expect(parseHandlingDecision({ ...valid, target: { copy: target(studio).copy } })).toBeNull()
    expect(
      parseHandlingDecision({
        ...valid,
        target: { ...target(studio), copy: { mailboxId: studio, messageId: '  ' } },
      }),
    ).toBeNull()
    expect(parseHandlingDecision({ ...valid, snoozeUntil: decidedAt })).toBeNull()
    expect(parseHandlingDecision(null)).toBeNull()
  })

  it('throws where a decision is built from values this app owns', () => {
    expect(() => decideHandling({ ...valid, outcome: 'handle_now', decidedAt: '' })).toThrow()
  })
})
