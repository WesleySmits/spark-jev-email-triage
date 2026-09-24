/**
 * What the workbench offers a reviewer, what a choice amounts to, and the
 * words for every state a save passes through.
 *
 * Two of these are promises the whole feature rests on, so they are checked
 * over every state rather than in one example: no state says a message was
 * completed, and no state can carry a subject, an address or a body.
 */
import { describe, expect, it } from 'vitest'
import type {
  ClassificationLabels,
  StoredClassification,
} from '../../../domain/stored-classification'
import type { ReviewRefusal } from '../../../domain/review'
import {
  reviewAnnouncement,
  reviewCategories,
  reviewPanelCopy,
  reviewRequest,
  reviewResult,
  reviewSignature,
  reviewableIn,
  verdictFor,
  type ReviewState,
} from './review'

const labels: ClassificationLabels = {
  category: 'newsletter',
  priority: 'low',
  confidence: 0.58,
  priorityUncertain: false,
  review: 'needs_review',
  reviewPriority: 'normal',
  grounds: {
    state: 'recorded',
    reasons: ['low_category_confidence'],
    suspicionSignals: [],
  },
}

const subject = {
  copy: { mailboxId: 'one@mail.example', messageId: '11' },
  threadId: '11',
  latestMessageId: '11',
  rubric: 'email-triage.v2',
  classifierVersion: 'jev-1.13.0',
}

const judged = { subject, judgedAt: '2026-09-22T09:15:00.000Z', labels }

const refusals: readonly ReviewRefusal[] = [
  'stale_subject',
  'unclassified',
  'other_copy',
  'unreadable',
]

const states: readonly ReviewState[] = [
  { status: 'choosing' },
  { status: 'unsaved' },
  { status: 'saving' },
  { status: 'saved', decision: 'confirmed', chosen: 'newsletter' },
  { status: 'saved', decision: 'corrected', chosen: 'personal' },
  ...refusals.map((reason) => ({ status: 'refused', reason }) as const),
  { status: 'failed' },
]

/** Every word one state puts on the page or into an announcement. */
const words = (state: ReviewState) => {
  const { title, detail } = reviewResult(state, 'Newsletter')
  return `${title} ${detail} ${reviewAnnouncement(state, 'Newsletter')}`
}

describe('reviewableIn', () => {
  it('offers a review of a judgment a thread proved current', () => {
    expect(reviewableIn({ ...judged, state: 'current' })).toEqual({ subject, labels })
  })

  it('offers a review of a judgment the store holds and contradicts in no way', () => {
    expect(reviewableIn({ ...judged, state: 'unverified' })).toEqual({ subject, labels })
  })

  it('offers no review of a version that has already moved on', () => {
    expect(reviewableIn({ ...judged, state: 'stale', reason: 'newer_message' })).toBeUndefined()
  })

  it('offers no review where nothing proposed labels to confirm or correct', () => {
    const cases: readonly (StoredClassification | undefined)[] = [
      { subject, judgedAt: judged.judgedAt, state: 'provider_failure', errorCode: 'timeout' },
      { state: 'none' },
      { state: 'unavailable', reason: 'unreadable' },
      undefined,
    ]

    for (const classification of cases) expect(reviewableIn(classification)).toBeUndefined()
  })
})

describe('verdictFor', () => {
  it('reads the category the model chose as a confirmation, carrying no labels of its own', () => {
    expect(verdictFor('newsletter', labels)).toEqual({ decision: 'confirmed' })
  })

  it('reads another category as a correction that keeps the judged priority', () => {
    expect(verdictFor('personal', labels)).toEqual({
      decision: 'corrected',
      labels: { category: 'personal', priority: 'low' },
    })
  })

  it('names the exact version the reviewer was shown', () => {
    expect(reviewRequest({ subject, labels }, 'personal')).toEqual({
      classification: subject,
      verdict: { decision: 'corrected', labels: { category: 'personal', priority: 'low' } },
    })
  })
})

describe('reviewSignature', () => {
  const reviewable = { subject, labels }
  const saved = {
    decidedBy: 'reviewer',
    decision: 'corrected',
    labels: { category: 'suspicious', priority: 'urgent' },
    reviewer: 'wesley',
    reviewedAt: '2026-09-23T08:30:00.000Z',
  } as const
  const signature = reviewSignature(reviewable, undefined)

  it('is the same for the same version, labels and stored review', () => {
    expect(reviewSignature({ subject: { ...subject }, labels: { ...labels } }, undefined)).toBe(
      signature,
    )
    expect(reviewSignature(reviewable, { ...saved })).toBe(reviewSignature(reviewable, saved))
  })

  it('changes with every part of the version being reviewed', () => {
    const moved = [
      { ...subject, copy: { ...subject.copy, mailboxId: 'two@mail.example' } },
      { ...subject, copy: { ...subject.copy, messageId: '12' } },
      { ...subject, threadId: '12' },
      { ...subject, latestMessageId: '13' },
      { ...subject, rubric: 'email-triage.v3' },
      { ...subject, classifierVersion: 'jev-1.14.0' },
    ]

    for (const version of moved) {
      expect(reviewSignature({ subject: version, labels }, undefined)).not.toBe(signature)
    }
  })

  it("changes with the model's own labels, which decide what a choice means", () => {
    // The same category is a confirmation against one judgment and a
    // correction against another, so a choice cannot outlive them.
    expect(
      reviewSignature({ subject, labels: { ...labels, category: 'personal' } }, undefined),
    ).not.toBe(signature)
    expect(
      reviewSignature({ subject, labels: { ...labels, priority: 'urgent' } }, undefined),
    ).not.toBe(signature)
  })

  it('changes when a review is stored, changed or gone', () => {
    expect(reviewSignature(reviewable, saved)).not.toBe(signature)
    expect(reviewSignature(reviewable, { ...saved, decision: 'confirmed' })).not.toBe(
      reviewSignature(reviewable, saved),
    )
    expect(
      reviewSignature(reviewable, { ...saved, labels: { category: 'personal', priority: 'low' } }),
    ).not.toBe(reviewSignature(reviewable, saved))
    expect(
      reviewSignature(reviewable, { ...saved, reviewedAt: '2026-09-23T09:30:00.000Z' }),
    ).not.toBe(reviewSignature(reviewable, saved))
  })

  it('ignores what does not change what is being reviewed', () => {
    // Confidence, the model's own review need and who reviewed decide
    // nothing a choice is made against.
    expect(reviewSignature({ subject, labels: { ...labels, confidence: 0.1 } }, undefined)).toBe(
      signature,
    )
    expect(
      reviewSignature({ subject, labels: { ...labels, review: 'auto_accepted' } }, undefined),
    ).toBe(signature)
    expect(reviewSignature(reviewable, { ...saved, reviewer: 'someone else' })).toBe(
      reviewSignature(reviewable, saved),
    )
  })
})

describe('reviewCategories', () => {
  it('offers every category of the rubric, as the reader reads them elsewhere', () => {
    expect(reviewCategories).toContainEqual({ value: 'newsletter', label: 'Newsletter' })
    expect(reviewCategories.map((category) => category.value)).toEqual([
      'personal',
      'notification',
      'security',
      'purchase',
      'newsletter',
      'promotion',
      'suspicious',
      'other',
    ])
  })
})

describe('the copy of every state', () => {
  it('never claims the message was completed, archived or handled', () => {
    for (const state of states) {
      const said = words(state)
      expect(said).not.toMatch(/\b(archived|handled|deleted)\b/i)
      // The one way "completed" may appear is to deny that anything was.
      for (const mention of said.matchAll(/completed/gi)) {
        expect(said.slice(0, mention.index)).toMatch(/Not $/)
      }
    }
  })

  it('carries no subject, address or body of the message it is about', () => {
    for (const state of states) {
      expect(words(state)).not.toMatch(/@|mail\.example|11/)
    }
  })

  it('says what was saved and says it is not a mailbox action', () => {
    expect(
      reviewResult({ status: 'saved', decision: 'confirmed', chosen: 'newsletter' }, 'Newsletter'),
    ).toEqual({
      title: 'Review saved',
      detail:
        'You confirmed Newsletter. This review covers the category only. Priority and reply expectations are not confirmed. Your mailbox is unchanged.',
    })
    expect(
      reviewResult({ status: 'saved', decision: 'corrected', chosen: 'personal' }, 'Newsletter'),
    ).toEqual({
      title: 'Review saved',
      detail:
        'Category set to Personal. The original stays Newsletter. This review covers the category only. Priority and reply expectations are not confirmed. Your mailbox is unchanged.',
    })
  })

  it.each(['confirmed', 'corrected'] as const)(
    '%s announces only a category review, leaving other fields unconfirmed',
    (decision) => {
      const state = { status: 'saved', decision, chosen: 'newsletter' } as const
      for (const text of [
        reviewResult(state, 'Newsletter').detail,
        reviewAnnouncement(state, 'Newsletter'),
      ]) {
        expect(text).toContain('This review covers the category only.')
        expect(text).toContain('Priority and reply expectations are not confirmed.')
      }
    },
  )

  it('tells a reviewer of a version that moved on what to do next', () => {
    expect(reviewResult({ status: 'refused', reason: 'stale_subject' }, 'Newsletter')).toEqual({
      title: 'Not saved',
      detail:
        'This triage is no longer the current one, so the review was refused. Refresh and open the message again to review what holds now.',
    })
  })

  it('says a failure stored nothing, rather than leaving it open', () => {
    expect(reviewResult({ status: 'failed' }, 'Newsletter').detail).toMatch(
      /could not be stored, so nothing was recorded/,
    )
  })
})

describe('reviewAnnouncement', () => {
  it('says nothing while a person is still choosing or saving', () => {
    expect(reviewAnnouncement({ status: 'choosing' }, 'Newsletter')).toBe('')
    expect(reviewAnnouncement({ status: 'unsaved' }, 'Newsletter')).toBe('')
    expect(reviewAnnouncement({ status: 'saving' }, 'Newsletter')).toBe('')
  })

  it('announces a saved review as saved, and as not completed', () => {
    expect(
      reviewAnnouncement(
        { status: 'saved', decision: 'corrected', chosen: 'personal' },
        'Newsletter',
      ),
    ).toBe(
      'Review saved. Category set to Personal. The original stays Newsletter. This review covers the category only. Priority and reply expectations are not confirmed. Your mailbox is unchanged. Not completed yet.',
    )
  })

  it('announces a refusal without claiming anything was saved', () => {
    const announced = reviewAnnouncement(
      { status: 'refused', reason: 'stale_subject' },
      'Newsletter',
    )

    expect(announced).toMatch(/^Not saved\./)
    expect(announced).not.toMatch(/Review saved/)
  })
})

describe('reviewPanelCopy', () => {
  it('asks for a person, and gives the ground the run actually recorded', () => {
    const copy = reviewPanelCopy(labels)

    expect(copy.title).toBe('Needs review')
    expect(copy.reason).toMatch(/^Triage policy asked for a person on the grounds below\./)
    expect(copy.reasons).toEqual([
      "The model's score for this category stayed under the level triage accepts on its own.",
    ])
    expect(copy.originalSuggestion).toBe('Newsletter')
    expect(copy.score).toBeCloseTo(58)
  })

  it('attributes the decision to policy rather than to the model itself', () => {
    // The model scored; ordinary code decided. Saying "the model asked for a
    // person" would credit it with a decision it never made.
    const { reason } = reviewPanelCopy(labels)

    expect(reason).toContain("rule over the model's scores")
    expect(reason).toContain("not the model's own account of itself")
    expect(reason).toContain('none of them says whether this triage still describes the mail')
  })

  it('still offers a review where the model accepted its own labels', () => {
    const copy = reviewPanelCopy({
      ...labels,
      review: 'auto_accepted',
      grounds: { state: 'recorded', reasons: [], suspicionSignals: [] },
    })

    expect(copy.title).toBe('Review this triage')
    expect(copy.reason).toMatch(/Nothing is a person's decision until a review says so\./)
    expect(copy.reasons).toEqual([])
  })

  it('says when policy raised how urgent a look is, as its own ground', () => {
    expect(reviewPanelCopy({ ...labels, reviewPriority: 'elevated' }).reasons).toContain(
      'Triage raised how urgent a look is, which asks for attention sooner and nothing else.',
    )
  })

  it('keeps the original suggestion visible, and never says saving completes anything', () => {
    const copy = reviewPanelCopy(labels)

    expect(copy.originalNote).toBe('This original suggestion is kept, whatever you decide.')
    expect(copy.categoriesHint).toBe(
      "This review covers the category only. Priority and reply expectations are not confirmed. It doesn't complete the message.",
    )
    expect(copy.saveLabel).toBe('Save review')
  })
})
