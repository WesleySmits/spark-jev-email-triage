import { describe, expect, it } from 'vitest'
import {
  approveProposal,
  proposeMailboxAction,
  type MailboxActionProposal,
  type TargetObservation,
} from '../../../domain/mailbox-action'
import type { StoredClassification } from '../../../domain/stored-classification'
import {
  actionEffect,
  actionPreconditions,
  actionResult,
  actionStages,
  actionTargets,
  observationIn,
  proposableIn,
  standingOf,
  type HeldProposal,
} from './action'

const studio = 'studio@mail.example'
const alias = 'alias@mail.example'

const subjectOf = (mailboxId: string) => ({
  copy: { mailboxId, messageId: '11' },
  threadId: 't-11',
  latestMessageId: '11',
  rubric: 'email-triage.v2',
  classifierVersion: 'jev-1.13.0',
})

const labels = {
  category: 'personal',
  priority: 'high',
  confidence: 0.93,
  priorityUncertain: false,
  review: 'auto_accepted',
  reviewPriority: 'normal',
} as const

const judgedAt = '2026-09-22T09:15:00.000Z'

const unverified: StoredClassification = {
  state: 'unverified',
  subject: subjectOf(studio),
  judgedAt,
  labels,
}

const current: StoredClassification = { ...unverified, state: 'current' }

const stale = (reason: 'newer_message' | 'other_snapshot' | 'rubric'): StoredClassification => ({
  ...unverified,
  state: 'stale',
  reason,
})

const targetOf = (mailboxId: string) => ({
  copy: { mailboxId, messageId: '11' },
  threadId: 't-11',
  latestMessageId: '11',
})

const proposalOf = (mailboxIds: readonly string[]): MailboxActionProposal =>
  proposeMailboxAction({
    kind: 'markAsSeen',
    targets: mailboxIds.map(targetOf),
    basis: { classification: subjectOf(studio) },
    proposedAt: judgedAt,
  })

const held = (mailboxIds: readonly string[] = [studio]): HeldProposal => ({
  proposal: proposalOf(mailboxIds),
  approval: null,
})

const labelOf = ({ mailboxId }: Readonly<{ mailboxId: string }>) =>
  mailboxId === studio ? 'Studio Noord' : 'Atelier Linden'

/** What the reading says about the open row now, as the page reads it. */
const observations = (classification: StoredClassification): readonly TargetObservation[] => {
  const observed = observationIn(classification)
  return observed === undefined ? [] : [observed]
}

describe('proposableIn', () => {
  it.each([
    ['a judgment a read proved current', current],
    ['a judgment the store alone holds', unverified],
  ])('names the copy and version of %s', (_name, classification) => {
    expect(proposableIn(classification)).toEqual({
      target: targetOf(studio),
      basis: { classification: subjectOf(studio) },
    })
  })

  it.each([
    ['an outdated judgment', stale('newer_message')],
    [
      'a failed attempt',
      { state: 'provider_failure', subject: subjectOf(studio), judgedAt, errorCode: 'timeout' },
    ],
    ['a row nothing classified', { state: 'none' }],
    ['a store that could not be read', { state: 'unavailable', reason: 'unreadable' }],
  ] satisfies readonly (readonly [string, StoredClassification])[])(
    'offers nothing to propose against for %s',
    (_name, classification) => {
      expect(proposableIn(classification)).toBeUndefined()
    },
  )

  it('offers nothing for a row no reading listed', () => {
    expect(proposableIn(undefined)).toBeUndefined()
  })

  it('names the judgment as a basis that authorizes nothing', () => {
    const proposable = proposableIn(current)
    const standing = standingOf(
      {
        proposal: proposeMailboxAction({ ...held().proposal, basis: proposable?.basis ?? null }),
        approval: null,
      },
      observations(current),
    )

    expect(standing?.stage).toBe('proposed')
  })
})

describe('observationIn', () => {
  it('is proven only where a thread read says so', () => {
    expect(observationIn(current)).toMatchObject({ observed: 'named', proven: true })
    expect(observationIn(unverified)).toMatchObject({ observed: 'named', proven: false })
  })

  it('says the thread moved where the store observed a later message', () => {
    expect(observationIn(stale('newer_message'))).toEqual({
      copy: { mailboxId: studio, messageId: '11' },
      observed: 'moved',
      reason: 'newer_message',
    })
  })

  it('says the thread moved where the copy now belongs to another one', () => {
    expect(observationIn(stale('other_snapshot'))).toMatchObject({
      observed: 'moved',
      reason: 'other_thread',
    })
  })

  it('does not call the thread moved because another rubric judged it', () => {
    expect(observationIn(stale('rubric'))).toMatchObject({ observed: 'named', proven: false })
  })

  it('says nothing about a row nothing was stored for', () => {
    expect(observationIn({ state: 'none' })).toBeUndefined()
    expect(observationIn(undefined)).toBeUndefined()
  })
})

describe('actionStages', () => {
  const stageOf = (stages: ReturnType<typeof actionStages>, id: string) =>
    stages.find((stage) => stage.id === id)

  it('shows proposal, approval and execution apart, in that order', () => {
    expect(actionStages(null, null).map((stage) => stage.id)).toEqual([
      'proposal',
      'approval',
      'execution',
    ])
  })

  it('says nothing is proposed before anything is', () => {
    expect(stageOf(actionStages(null, null), 'proposal')?.state.label).toBe('Nothing proposed')
    expect(stageOf(actionStages(null, null), 'approval')?.state.label).toBe('Not approved')
  })

  it('keeps a proposal waiting for a person', () => {
    const stages = actionStages(held(), standingOf(held(), observations(current)))

    expect(stageOf(stages, 'proposal')?.state.label).toBe('Proposed')
    expect(stageOf(stages, 'approval')?.state.label).toBe('Waiting for you')
  })

  it('says an approval lapsed once a later message reached the thread', () => {
    const proposal = proposalOf([studio])
    const approved: HeldProposal = {
      proposal,
      approval: approveProposal(proposal, {
        approvedBy: 'you, at this computer',
        approvedAt: judgedAt,
      }),
    }
    const stages = actionStages(
      approved,
      standingOf(approved, observations(stale('newer_message'))),
    )

    expect(stageOf(stages, 'proposal')?.state.label).toBe('Out of date')
    expect(stageOf(stages, 'approval')?.state.label).toBe('No longer holds')
  })

  it.each([
    ['nothing proposed', null, null],
    ['a proposal', held(), standingOf(held(), observations(current))],
  ] as const)('says execution is blocked with %s', (_name, proposal, standing) => {
    const execution = stageOf(actionStages(proposal, standing), 'execution')

    expect(execution?.state.label).toBe('Blocked')
    expect(execution?.detail).toContain('no way to write to a mailbox')
  })
})

describe('actionTargets', () => {
  it('names every copy the proposal holds, and no other', () => {
    const targets = actionTargets(held([studio]), observations(current), labelOf)

    expect(targets).toHaveLength(1)
    expect(targets[0]?.label).toBe('Studio Noord')
    expect(targets[0]?.identity).toBe(`${studio} · message 11`)
    expect(targets.map((target) => target.identity).join(' ')).not.toContain(alias)
  })

  it('names an alias copy only where the proposal named it', () => {
    const targets = actionTargets(held([studio, alias]), observations(current), labelOf)

    expect(targets.map((target) => target.identity)).toEqual([
      `${studio} · message 11`,
      `${alias} · message 11`,
    ])
  })

  it('tells apart two mailboxes shown under one name, on one message id', () => {
    // Nothing stops two mailboxes carrying the same label, and one provider
    // message id may be listed in both. The name alone would then read the
    // same for two different copies, so the ids are what is shown.
    const sameLabel = () => 'Shared inbox'
    const targets = actionTargets(held([studio, alias]), observations(current), sameLabel)

    expect(targets.map((target) => target.label)).toEqual(['Shared inbox', 'Shared inbox'])
    expect(targets.map((target) => target.identity)).toEqual([
      `${studio} · message 11`,
      `${alias} · message 11`,
    ])
    expect(new Set(targets.map((target) => target.id)).size).toBe(2)
  })

  it('names the mailbox by its id even where the workbench cannot name it', () => {
    const unknown = () => 'Another mailbox'
    const [target] = actionTargets(held([studio]), observations(current), unknown)

    expect(target?.identity).toBe(`${studio} · message 11`)
  })

  it('says of each copy the version proposed against and where it stands', () => {
    const [target] = actionTargets(held(), observations(current), labelOf)

    expect(target?.detail).toContain('thread t-11, latest message 11')
    expect(target?.detail).toContain('still ends there')
  })

  it('says an alias copy nothing read is unobserved', () => {
    const targets = actionTargets(held([studio, alias]), observations(current), labelOf)

    expect(targets[1]?.detail).toContain('Nothing read says where this copy stands now')
  })

  it('says a copy whose thread moved on has moved on', () => {
    const [target] = actionTargets(held(), observations(stale('newer_message')), labelOf)

    expect(target?.detail).toContain('A later message has reached this thread since')
  })

  it('names no copy at all before anything is proposed', () => {
    expect(actionTargets(null, [], labelOf)).toEqual([])
  })
})

describe('actionPreconditions', () => {
  const namesOf = (views: ReturnType<typeof actionPreconditions>) => views.map((view) => view.id)

  it('names one thread precondition per target, then approval and the adapter', () => {
    const views = actionPreconditions(
      held([studio, alias]),
      standingOf(held([studio, alias]), observations(current)),
      observations(current),
      labelOf,
    )

    expect(namesOf(views)).toEqual([
      'thread_unchanged:["studio@mail.example","11"]',
      'thread_unchanged:["alias@mail.example","11"]',
      'human_approval',
      'write_adapter_connected',
    ])
  })

  it('never reports the write adapter as met', () => {
    const views = actionPreconditions(
      held(),
      standingOf(held(), observations(current)),
      observations(current),
      labelOf,
    )

    expect(views.at(-1)).toEqual({
      id: 'write_adapter_connected',
      label: 'Something could carry the action out',
      state: { label: 'Not connected', tone: 'neutral' },
    })
  })

  it('names approval and the adapter even before anything is proposed', () => {
    expect(namesOf(actionPreconditions(null, null, [], labelOf))).toEqual([
      'human_approval',
      'write_adapter_connected',
    ])
  })

  it('names each thread precondition by its mailbox id, not only its name', () => {
    const sameLabel = () => 'Shared inbox'
    const views = actionPreconditions(
      held([studio, alias]),
      standingOf(held([studio, alias]), observations(current)),
      observations(current),
      sameLabel,
    )

    expect(views[0]?.label).toBe(`The thread of Shared inbox (${studio}) still ends at message 11`)
    expect(views[1]?.label).toBe(`The thread of Shared inbox (${alias}) still ends at message 11`)
  })

  it('reports a thread a read proved as met and an unread one as not', () => {
    const views = actionPreconditions(
      held([studio, alias]),
      standingOf(held([studio, alias]), observations(current)),
      observations(current),
      labelOf,
    )

    expect(views[0]?.state.label).toBe('Met')
    expect(views[1]?.state.label).toBe('Not met')
  })
})

describe('actionEffect', () => {
  it('says nothing would change before anything is proposed', () => {
    const effect = actionEffect(null, labelOf)

    expect(effect.statement).toBe('Nothing is proposed, so nothing would change.')
    expect(effect.note).toContain('Your mailbox is unchanged.')
  })

  it('names the copies it would ask for, by their ids, and nothing else', () => {
    const effect = actionEffect(held([studio]), labelOf)

    expect(effect.statement).toContain('mark only the copy named above as read')
    expect(effect.statement).toContain(`Studio Noord (${studio} · message 11)`)
    expect(effect.statement).not.toContain(alias)
  })

  it('names both copies where both were proposed against', () => {
    const effect = actionEffect(held([studio, alias]), labelOf)

    expect(effect.statement).toContain('the copies named above')
    expect(effect.statement).toContain(studio)
    expect(effect.statement).toContain(alias)
  })

  it('claims nothing about what a provider would do, or about the thread', () => {
    const { statement, note } = actionEffect(held([studio]), labelOf)

    expect(note).toContain('target these exact mailbox copies')
    expect(note).toContain('effect on the rest of the thread is also unverified')
    expect(note).toContain('No live write is connected')
    // It describes a request nobody has made, never something that happened.
    expect(`${statement} ${note}`).not.toMatch(/was marked as read|has been marked as read/i)
    expect(statement).toMatch(/^The intended effect is/)
  })
})

describe('actionResult', () => {
  const results = [
    actionResult(null, null),
    actionResult(standingOf(held(), observations(current)), null),
    actionResult(standingOf(held(), observations(stale('newer_message'))), null),
    actionResult(null, 'stale_target'),
    actionResult(null, 'other_proposal'),
  ]

  it.each(results.map((result, index) => [index, result]))(
    'says the mailbox is unchanged in state %i',
    (_index, result) => {
      expect(result.detail).toContain('Your mailbox is unchanged.')
    },
  )

  it.each(results.map((result, index) => [index, result]))(
    'never says a message was archived or completed in state %i',
    (_index, result) => {
      expect(`${result.title} ${result.detail}`).not.toMatch(/archived|completed|done/i)
    },
  )

  it('says an approval was not carried out', () => {
    const proposal = proposalOf([studio])
    const approval = approveProposal(proposal, { approvedBy: 'you', approvedAt: judgedAt })
    const result = actionResult(standingOf({ proposal, approval }, observations(current)), null)

    expect(result.title).toBe('Approved, not carried out')
    expect(result.detail).toContain('nothing can be')
  })

  it('says why approving was refused, without naming the message', () => {
    expect(actionResult(null, 'stale_target').detail).toContain('moved past')
    expect(actionResult(null, 'other_proposal').detail).toContain('another proposal')
  })
})
