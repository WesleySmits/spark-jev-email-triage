import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { syntheticThreads } from '../domain/fixtures'
import { categorySchema, prioritySchema } from '../domain/triage'
import {
  requiredCoverage,
  reviewedCases,
  reviewedMailboxAddress,
  reviewedThread,
} from './reviewed-set'

const source = readFileSync(new URL('./reviewed-set.ts', import.meta.url), 'utf8')

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
      }).toEqual(reviewed.reviewedVersion)
    }
  })

  it('give a rubric category, a rubric priority and a reason a person wrote', () => {
    for (const { expectation } of reviewedCases) {
      expect(categorySchema.parse(expectation.category)).toBe(expectation.category)
      expect(prioritySchema.parse(expectation.priority)).toBe(expectation.priority)
      expect(expectation.rationale.trim().length).toBeGreaterThan(40)
    }
  })

  it('record where every case came from and when it was last read', () => {
    for (const { provenance } of reviewedCases) {
      expect(['invented', 'sanitized']).toContain(provenance.origin)
      expect(provenance.note.trim()).not.toBe('')
      expect(provenance.reviewedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/)
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
