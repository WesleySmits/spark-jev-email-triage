import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { threadSchema } from '../domain/email'
import { syntheticThreads } from '../domain/fixtures'
import { defaultRubric } from '../domain/rubric'
import { categorySchema, prioritySchema } from '../domain/triage'
import {
  reviewedCases,
  reviewedMailboxAddress,
  reviewedThread,
  requiredCoverage,
} from './reviewed-set'
import { threadDigest } from './thread-digest'

const source = readFileSync(new URL('./reviewed-set.ts', import.meta.url), 'utf8')

function caseFor(fixture: string) {
  const found = reviewedCases.find((reviewed) => reviewed.fixture === fixture)
  if (found === undefined) throw new Error(`No reviewed case for ${fixture}`)
  return found
}

describe('reviewedCases', () => {
  it('cover ambiguous, suspicious, personal, purchase and notification mail', () => {
    const covered = reviewedCases.map(({ expectation }) => expectation.category)

    for (const category of requiredCoverage) {
      expect(covered).toContain(category)
    }
  })

  it('label every synthetic thread exactly once', () => {
    const labelled = reviewedCases.map(({ fixture }) => fixture)

    expect(new Set(labelled).size).toBe(labelled.length)
    expect([...labelled].sort()).toEqual(Object.keys(syntheticThreads).sort())
  })

  it('name the thread version each expectation was written against', () => {
    for (const reviewed of reviewedCases) {
      const thread = reviewedThread(reviewed)

      expect({
        subject: thread.subject,
        latestMessageId: thread.messages.at(-1)?.id,
        threadDigest: threadDigest(thread),
      }).toEqual({
        subject: reviewed.writtenAgainst.subject,
        latestMessageId: reviewed.writtenAgainst.latestMessageId,
        threadDigest: reviewed.writtenAgainst.threadDigest,
      })
    }
  })

  // A subject and a latest message id are too little to pin on: the mail a
  // reader judged is the whole thread, as `classificationSubjectSchema` has
  // it. Edit an earlier message's body and both of those still match.
  it('notice an edited body that leaves the subject and every message id alone', () => {
    const reviewed = caseFor('multiMessage')
    const thread = reviewedThread(reviewed)
    const edited = threadSchema.parse({
      ...thread,
      messages: thread.messages.map((message, index) =>
        index === 0 ? { ...message, bodyText: 'The item arrived in perfect condition.' } : message,
      ),
    })

    expect(edited.subject).toBe(reviewed.writtenAgainst.subject)
    expect(edited.messages.map(({ id }) => id)).toEqual(thread.messages.map(({ id }) => id))
    expect(edited.messages.at(-1)).toEqual(thread.messages.at(-1))
    expect(threadDigest(edited)).not.toBe(reviewed.writtenAgainst.threadDigest)
  })

  it('digest a thread by its content, not by the order its fields are written', () => {
    const thread = reviewedThread(caseFor('invoice'))
    const reordered = threadSchema.parse({
      messages: thread.messages,
      subject: thread.subject,
      mailboxId: thread.mailboxId,
      id: thread.id,
    })

    expect(threadDigest(reordered)).toBe(threadDigest(thread))
  })

  // Categories, priorities and thresholds belong to a rubric version. Bumping
  // the rubric must not carry labels chosen under the old meanings with it.
  it('pin the rubric the labels were chosen under, and it is the current one', () => {
    for (const { writtenAgainst } of reviewedCases) {
      expect(writtenAgainst.rubricId).toBe(defaultRubric.id)
    }
  })

  it('give a rubric category, a rubric priority and an argument for both', () => {
    for (const { expectation } of reviewedCases) {
      expect(categorySchema.parse(expectation.category)).toBe(expectation.category)
      expect(prioritySchema.parse(expectation.priority)).toBe(expectation.priority)
      expect(expectation.rationale.trim().length).toBeGreaterThan(40)
    }
  })

  it('say who proposed the labels and claim no confirmation that has not happened', () => {
    for (const { curation } of reviewedCases) {
      expect(curation.proposedBy.trim()).not.toBe('')
      expect(curation.proposedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(curation.confirmedBy !== null && curation.confirmedOn !== null).toBe(
        curation.state === 'confirmed',
      )
    }
  })

  // Nobody can change a proposal without reading it first.
  it('are read by a person before any of them is recorded as changed', () => {
    for (const { curation } of reviewedCases) {
      if (curation.changedOnReview) expect(curation.state).toBe('confirmed')
    }
  })

  // Ticket 006 wants expectations a person authored. An assistant proposed
  // these and a person then read every one, keeping most and correcting two.
  it('have all been read by a named person', () => {
    for (const { curation } of reviewedCases) {
      expect(curation.state).toBe('confirmed')
      expect(curation.confirmedBy).toBe('Wesley Smits')
      expect(curation.confirmedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    }
  })

  it('record where every case came from', () => {
    for (const { provenance } of reviewedCases) {
      expect(['invented', 'sanitized']).toContain(provenance.origin)
      expect(provenance.note.trim()).not.toBe('')
    }
  })

  it('read every case as one mailbox the synthetic threads are addressed to', () => {
    const recipients = reviewedCases.flatMap((reviewed) =>
      reviewedThread(reviewed).messages.flatMap((message) =>
        message.to.map(({ address }) => address),
      ),
    )

    expect(recipients).toContain(reviewedMailboxAddress)
  })

  // The set is the yardstick, so it may not be built from what it measures,
  // and CI runs it without a provider or a secret.
  it('take nothing from the classifier, the provider or the environment', () => {
    expect(source).not.toMatch(/from '\.\.\/jev/)
    expect(source).not.toMatch(/@typesafe-ai/)
    expect(source).not.toMatch(/process\.env/)
  })
})
