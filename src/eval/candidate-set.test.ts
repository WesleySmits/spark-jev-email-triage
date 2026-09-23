import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { threadSchema } from '../domain/email'
import { syntheticThreads } from '../domain/fixtures'
import { defaultRubric } from '../domain/rubric'
import { categorySchema, prioritySchema } from '../domain/triage'
import {
  candidateCases,
  candidateMailboxAddress,
  candidateThread,
  requiredCoverage,
} from './candidate-set'
import { threadDigest } from './thread-digest'

const source = readFileSync(new URL('./candidate-set.ts', import.meta.url), 'utf8')

function caseFor(fixture: string) {
  const found = candidateCases.find((candidate) => candidate.fixture === fixture)
  if (found === undefined) throw new Error(`No candidate case for ${fixture}`)
  return found
}

describe('candidateCases', () => {
  it('cover ambiguous, suspicious, personal, purchase and notification mail', () => {
    const covered = candidateCases.map(({ expectation }) => expectation.category)

    for (const category of requiredCoverage) {
      expect(covered).toContain(category)
    }
  })

  it('label every synthetic thread exactly once', () => {
    const labelled = candidateCases.map(({ fixture }) => fixture)

    expect(new Set(labelled).size).toBe(labelled.length)
    expect([...labelled].sort()).toEqual(Object.keys(syntheticThreads).sort())
  })

  it('name the thread version each expectation was written against', () => {
    for (const candidate of candidateCases) {
      const thread = candidateThread(candidate)

      expect({
        subject: thread.subject,
        latestMessageId: thread.messages.at(-1)?.id,
        threadDigest: threadDigest(thread),
      }).toEqual({
        subject: candidate.writtenAgainst.subject,
        latestMessageId: candidate.writtenAgainst.latestMessageId,
        threadDigest: candidate.writtenAgainst.threadDigest,
      })
    }
  })

  // A subject and a latest message id are too little to pin on: the mail a
  // reader judged is the whole thread, as `classificationSubjectSchema` has
  // it. Edit an earlier message's body and both of those still match.
  it('notice an edited body that leaves the subject and every message id alone', () => {
    const candidate = caseFor('multiMessage')
    const thread = candidateThread(candidate)
    const edited = threadSchema.parse({
      ...thread,
      messages: thread.messages.map((message, index) =>
        index === 0 ? { ...message, bodyText: 'The item arrived in perfect condition.' } : message,
      ),
    })

    expect(edited.subject).toBe(candidate.writtenAgainst.subject)
    expect(edited.messages.map(({ id }) => id)).toEqual(thread.messages.map(({ id }) => id))
    expect(edited.messages.at(-1)).toEqual(thread.messages.at(-1))
    expect(threadDigest(edited)).not.toBe(candidate.writtenAgainst.threadDigest)
  })

  it('digest a thread by its content, not by the order its fields are written', () => {
    const thread = candidateThread(caseFor('invoice'))
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
    for (const { writtenAgainst } of candidateCases) {
      expect(writtenAgainst.rubricId).toBe(defaultRubric.id)
    }
  })

  it('give a rubric category, a rubric priority and an argument for both', () => {
    for (const { expectation } of candidateCases) {
      expect(categorySchema.parse(expectation.category)).toBe(expectation.category)
      expect(prioritySchema.parse(expectation.priority)).toBe(expectation.priority)
      expect(expectation.rationale.trim().length).toBeGreaterThan(40)
    }
  })

  it('say who wrote the labels and claim no confirmation that has not happened', () => {
    for (const { curation } of candidateCases) {
      expect(curation.by.trim()).not.toBe('')
      expect(curation.writtenOn).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(curation.confirmedBy !== null && curation.confirmedOn !== null).toBe(
        curation.state === 'confirmed',
      )
    }
  })

  // Ticket 006 wants expectations a person authored. These were written by an
  // assistant and are a proposal until a named person reads them. Update this
  // in the same change that records the confirmation.
  it('are still waiting for a person to confirm them', () => {
    expect(candidateCases.filter(({ curation }) => curation.state === 'confirmed')).toEqual([])
  })

  it('record where every case came from', () => {
    for (const { provenance } of candidateCases) {
      expect(['invented', 'sanitized']).toContain(provenance.origin)
      expect(provenance.note.trim()).not.toBe('')
    }
  })

  it('read every case as one mailbox the synthetic threads are addressed to', () => {
    const recipients = candidateCases.flatMap((candidate) =>
      candidateThread(candidate).messages.flatMap((message) =>
        message.to.map(({ address }) => address),
      ),
    )

    expect(recipients).toContain(candidateMailboxAddress)
  })

  // The set is the yardstick, so it may not be built from what it measures,
  // and CI runs it without a provider or a secret.
  it('take nothing from the classifier, the provider or the environment', () => {
    expect(source).not.toMatch(/from '\.\.\/jev/)
    expect(source).not.toMatch(/@typesafe-ai/)
    expect(source).not.toMatch(/process\.env/)
  })
})
