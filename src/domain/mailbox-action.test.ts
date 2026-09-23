import { describe, expect, it } from 'vitest'
import { mailboxCopyId } from './mailbox-copy'
import {
  actionStanding,
  admitApproval,
  approveProposal,
  preconditionsFor,
  proposalId,
  proposalStanding,
  proposeMailboxAction,
  targetStanding,
  type ActionTarget,
  type MailboxActionProposal,
  type TargetObservation,
} from './mailbox-action'

const studio = 'studio@mail.example'
const alias = 'alias@mail.example'

/** One target: the same message id, in whichever mailbox it was listed. */
const target = (mailboxId: string, messageId = '11'): ActionTarget => ({
  copy: { mailboxId, messageId },
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

const proposal = (targets: ActionTarget[] = [target(studio)]) =>
  proposeMailboxAction({
    kind: 'archive',
    targets,
    basis: { classification: judged },
    proposedAt: '2026-09-22T09:15:00.000Z',
  })

/**
 * A thread the provider just returned for `copy`, as it stands there.
 * `proven` false is the same reading from a store alone.
 */
const read = (
  mailboxId: string,
  latestMessageId = '11',
  threadId = 't-11',
  proven = true,
): TargetObservation => ({
  copy: { mailboxId, messageId: '11' },
  observed: 'named',
  threadId,
  latestMessageId,
  proven,
})

const approvedAt = '2026-09-22T10:00:00.000Z'
const approve = (of: MailboxActionProposal) =>
  approveProposal(of, { approvedBy: 'the person at this computer', approvedAt })

describe('proposeMailboxAction', () => {
  it('names exactly the mailbox copies it was given', () => {
    expect(proposal().targets).toEqual([target(studio)])
  })

  it('keeps the instant it was proposed, in UTC', () => {
    expect(proposal().proposedAt).toBe('2026-09-22T09:15:00.000Z')
  })

  it('refuses a proposal that names no target', () => {
    expect(() => proposal([])).toThrow()
  })

  it('refuses the same mailbox copy twice', () => {
    expect(() => proposal([target(studio), target(studio)])).toThrow()
  })

  it('refuses a target whose thread version is missing', () => {
    expect(() =>
      proposeMailboxAction({
        kind: 'archive',
        targets: [
          { copy: { mailboxId: studio, messageId: '11' }, threadId: '', latestMessageId: '11' },
        ],
        basis: null,
        proposedAt: '2026-09-22T09:15:00.000Z',
      }),
    ).toThrow()
  })
})

describe('alias copies', () => {
  it('leaves a copy of the same message in another mailbox out of the targets', () => {
    const copies = proposal().targets.map(({ copy }) => mailboxCopyId(copy))

    expect(copies).not.toContain(mailboxCopyId({ mailboxId: alias, messageId: '11' }))
  })

  it('acts on an alias copy only where that copy was named', () => {
    const both = proposal([target(studio), target(alias)])

    expect(both.targets.map(({ copy }) => copy.mailboxId)).toEqual([studio, alias])
    expect(proposalId(both)).not.toBe(proposalId(proposal()))
  })

  it('leaves an alias copy unobserved when only the named copy was read', () => {
    const both = proposal([target(studio), target(alias)])

    expect(targetStanding(target(studio), [read(studio)])).toEqual({ status: 'holds' })
    expect(targetStanding(target(alias), [read(studio)])).toEqual({ status: 'unobserved' })
    expect(proposalStanding(both, [read(studio)])).toEqual({ status: 'unobserved' })
  })

  it('does not break a copy because its alias thread moved on', () => {
    expect(targetStanding(target(studio), [read(alias, '12')])).toEqual({ status: 'unobserved' })
  })
})

describe('preconditionsFor', () => {
  it('names one thread precondition per target, approval and the adapter', () => {
    expect(preconditionsFor(proposal([target(studio), target(alias)]))).toEqual([
      { name: 'thread_unchanged', ...target(studio) },
      { name: 'thread_unchanged', ...target(alias) },
      { name: 'human_approval' },
      { name: 'write_adapter_connected' },
    ])
  })
})

describe('targetStanding', () => {
  it('holds where a thread just read names the version proposed against', () => {
    expect(targetStanding(target(studio), [read(studio)])).toEqual({ status: 'holds' })
  })

  it('is unproven where only a store says so', () => {
    expect(targetStanding(target(studio), [read(studio, '11', 't-11', false)])).toEqual({
      status: 'unproven',
    })
  })

  it('breaks on a later message in the thread', () => {
    expect(targetStanding(target(studio), [read(studio, '12')])).toEqual({
      status: 'broken',
      reason: 'newer_message',
    })
  })

  it('breaks on another thread for the copy', () => {
    expect(targetStanding(target(studio), [read(studio, '11', 't-9')])).toEqual({
      status: 'broken',
      reason: 'other_thread',
    })
  })

  it('breaks on a reading that says the thread moved without naming what replaced it', () => {
    expect(
      targetStanding(target(studio), [
        {
          copy: { mailboxId: studio, messageId: '11' },
          observed: 'moved',
          reason: 'newer_message',
        },
      ]),
    ).toEqual({ status: 'broken', reason: 'newer_message' })
  })

  it('breaks even where a store, not a read, saw the later message', () => {
    expect(targetStanding(target(studio), [read(studio, '12', 't-11', false)])).toEqual({
      status: 'broken',
      reason: 'newer_message',
    })
  })
})

describe('actionStanding', () => {
  it('waits for a person while nothing is approved', () => {
    const standing = actionStanding(proposal(), null, [read(studio)])

    expect(standing.stage).toBe('proposed')
    expect(standing.targets).toEqual({ status: 'holds' })
  })

  it('does not let the classification it was proposed from approve it', () => {
    // The basis names a judged subject; it explains the proposal and permits
    // nothing, so the proposal still waits for a person.
    expect(proposal().basis).toEqual({ classification: judged })
    expect(actionStanding(proposal(), null, [read(studio)]).stage).toBe('proposed')
  })

  it('moves to approved on a person approving, which is its own transition', () => {
    const one = proposal()
    const standing = actionStanding(one, approve(one), [read(studio)])

    expect(standing.stage).toBe('approved')
    expect(standing).toMatchObject({
      approval: { approvedBy: 'the person at this computer', approvedAt },
    })
  })

  it('ignores an approval of another proposal', () => {
    const standing = actionStanding(proposal(), approve(proposal([target(alias)])), [read(studio)])

    expect(standing.stage).toBe('proposed')
  })

  it('invalidates an approval once a later message reaches the thread', () => {
    const one = proposal()
    const standing = actionStanding(one, approve(one), [read(studio, '12')])

    expect(standing).toMatchObject({
      stage: 'invalidated',
      reason: 'newer_message',
      wasApproved: true,
    })
  })

  it('says an unapproved proposal was never approved when it goes stale', () => {
    expect(actionStanding(proposal(), null, [read(studio, '12')])).toMatchObject({
      stage: 'invalidated',
      wasApproved: false,
    })
  })

  it('invalidates the whole proposal when one of two targets moved on', () => {
    const both = proposal([target(studio), target(alias)])

    expect(actionStanding(both, approve(both), [read(studio), read(alias, '12')])).toMatchObject({
      stage: 'invalidated',
      reason: 'newer_message',
    })
  })
})

describe('execution', () => {
  const unmetIn = (standing: ReturnType<typeof actionStanding>) =>
    standing.execution.unmet.map((precondition) => precondition.name)

  it('is blocked on the write adapter even once a person approved every target', () => {
    const one = proposal()
    const standing = actionStanding(one, approve(one), [read(studio)])

    expect(standing.stage).toBe('approved')
    expect(standing.execution.status).toBe('blocked')
    expect(unmetIn(standing)).toEqual(['write_adapter_connected'])
  })

  it('names the approval and every unproven target it is also missing', () => {
    const both = proposal([target(studio), target(alias)])
    const standing = actionStanding(both, null, [read(studio)])

    expect(standing.execution.unmet).toEqual([
      { name: 'thread_unchanged', ...target(alias) },
      { name: 'human_approval' },
      { name: 'write_adapter_connected' },
    ])
  })

  it('needs a person again once a stale target invalidated the approval', () => {
    const one = proposal()
    const standing = actionStanding(one, approve(one), [read(studio, '12')])

    expect(unmetIn(standing)).toEqual([
      'thread_unchanged',
      'human_approval',
      'write_adapter_connected',
    ])
  })
})

describe('admitApproval', () => {
  it('admits an approval of the proposal as it stands', () => {
    const one = proposal()

    expect(admitApproval(one, approve(one), [read(studio)])).toEqual({ status: 'admitted' })
  })

  it('refuses an approval once a target moved on', () => {
    const one = proposal()

    expect(admitApproval(one, approve(one), [read(studio, '12')])).toEqual({
      status: 'refused',
      reason: 'stale_target',
    })
  })

  it('refuses an approval of another proposal', () => {
    const one = proposal()

    expect(admitApproval(one, approve(proposal([target(alias)])), [read(studio)])).toEqual({
      status: 'refused',
      reason: 'other_proposal',
    })
  })

  it('refuses an approval of another version of the same copy', () => {
    const one = proposal()
    const later = proposal([{ ...target(studio), latestMessageId: '12' }])

    expect(admitApproval(one, approve(later), [read(studio)])).toEqual({
      status: 'refused',
      reason: 'other_proposal',
    })
  })
})
