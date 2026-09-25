/**
 * What the workbench offers a reviewer, what a choice amounts to, and the
 * words for every state a save passes through.
 *
 * Three of these are promises the whole feature rests on, so they are checked
 * over every state rather than in one example: no state says a message was
 * completed, no state can carry a subject, an address or a body, and a field
 * nobody touched is never recorded, counted or described as decided.
 */
import { describe, expect, it } from 'vitest'
import type { RowReview } from '../../../app/desk-review'
import type { ReviewRefusal } from '../../../domain/review'
import type {
  ClassificationLabels,
  StoredClassification,
} from '../../../domain/stored-classification'
import {
  adviceLabelFor,
  decidedByFor,
  decisionsIn,
  fieldStateFor,
  isPending,
  optionsFor,
  outOfScopeNote,
  pendingFields,
  reviewAnnouncement,
  reviewFields,
  reviewPanelCopy,
  reviewRequest,
  reviewResult,
  reviewSignature,
  reviewableIn,
  saveLabelFor,
  storedDecisions,
  verdictFor,
  without,
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
const reviewable = { subject, labels }

const decidedAt = '2026-09-23T08:30:00.000Z'

/** One field decision, as a reading projects who made it and when. */
const by = (decision: 'confirmed' | 'corrected', at: string = decidedAt) =>
  ({ decision, reviewer: 'wesley', reviewedAt: at }) as const

/** A stored review of the category alone, as the store answers one save. */
const savedCategory: RowReview = {
  decidedBy: 'reviewer',
  decision: 'corrected',
  labels: { category: 'personal' },
  fields: { category: by('corrected') },
  reviewer: 'wesley',
  reviewedAt: decidedAt,
}

const refusals: readonly ReviewRefusal[] = [
  'stale_subject',
  'unclassified',
  'other_copy',
  'unreadable',
  'request_conflict',
]

const states: readonly ReviewState[] = [
  { status: 'choosing' },
  { status: 'unsaved', fields: 1 },
  { status: 'unsaved', fields: 2 },
  { status: 'saving' },
  { status: 'saved', decided: [{ field: 'category', value: 'newsletter', decision: 'confirmed' }] },
  {
    status: 'saved',
    decided: [
      { field: 'category', value: 'personal', decision: 'corrected' },
      { field: 'priority', value: 'low', decision: 'confirmed' },
    ],
  },
  { status: 'saved', decided: [{ field: 'priority', value: 'urgent', decision: 'corrected' }] },
  ...refusals.map((reason) => ({ status: 'refused', reason }) as const),
  { status: 'failed' },
  { status: 'unknown' },
]

/** Every word one state puts on the page or into an announcement. */
const words = (state: ReviewState) => {
  const { title, detail } = reviewResult(state)
  return `${title} ${detail} ${reviewAnnouncement(state)}`
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

describe('the fields a person may decide', () => {
  it('are the category and the priority, and nothing else', () => {
    expect(reviewFields).toEqual(['category', 'priority'])
  })

  it('offer every value of the rubric, with the advice marked as the advice', () => {
    expect(optionsFor('category', labels)).toEqual([
      { value: 'personal', label: 'Personal' },
      { value: 'notification', label: 'Notification' },
      { value: 'security', label: 'Security' },
      { value: 'purchase', label: 'Purchase' },
      { value: 'newsletter', label: 'Newsletter', note: "The model's advice" },
      { value: 'promotion', label: 'Promotion' },
      { value: 'suspicious', label: 'Suspicious' },
      { value: 'other', label: 'Other' },
    ])
    expect(optionsFor('priority', labels)).toEqual([
      { value: 'urgent', label: 'Urgent' },
      { value: 'high', label: 'High' },
      { value: 'normal', label: 'Normal' },
      { value: 'low', label: 'Low', note: "The model's advice" },
    ])
  })

  it('name the label the classifier advised for each of them', () => {
    expect(adviceLabelFor('category', labels)).toBe('Newsletter')
    expect(adviceLabelFor('priority', labels)).toBe('Low')
  })
})

describe('what one Save would record', () => {
  it('records nothing at all while no field has been touched', () => {
    expect(pendingFields({}, undefined)).toEqual([])
    expect(verdictFor(reviewable, {}, undefined)).toEqual({})
    expect(saveLabelFor(0)).toBe('Save review')
  })

  it('records one field a person changed, and says so before saving', () => {
    const choices = { category: 'personal' } as const

    expect(pendingFields(choices, undefined)).toEqual(['category'])
    expect(verdictFor(reviewable, choices, undefined)).toEqual({
      category: { decision: 'corrected', value: 'personal' },
    })
    expect(saveLabelFor(1)).toBe('Save 1 field')
  })

  // Choosing the advised value is how a person says they agree with it. It is
  // the only way a confirmation is recorded: leaving the field alone is not.
  it('records a confirmation where a person chose the advised value', () => {
    expect(verdictFor(reviewable, { category: 'newsletter' }, undefined)).toEqual({
      category: { decision: 'confirmed' },
    })
    expect(verdictFor(reviewable, { priority: 'low' }, undefined)).toEqual({
      priority: { decision: 'confirmed' },
    })
  })

  it('records both fields where a person decided both, and counts them', () => {
    const choices = { category: 'personal', priority: 'urgent' } as const

    expect(pendingFields(choices, undefined)).toEqual(['category', 'priority'])
    expect(verdictFor(reviewable, choices, undefined)).toEqual({
      category: { decision: 'corrected', value: 'personal' },
      priority: { decision: 'corrected', value: 'urgent' },
    })
    expect(saveLabelFor(2)).toBe('Save 2 fields')
  })

  // The store already holds that decision. Recording it again would append a
  // second review that decided exactly what the first one did.
  it('records nothing for a field chosen as it is already stored', () => {
    expect(isPending('category', { category: 'personal' }, savedCategory)).toBe(false)
    expect(pendingFields({ category: 'personal' }, savedCategory)).toEqual([])
    expect(verdictFor(reviewable, { category: 'personal' }, savedCategory)).toEqual({})
  })

  it('records a field decided again, differently, over what is stored', () => {
    expect(pendingFields({ category: 'purchase' }, savedCategory)).toEqual(['category'])
    expect(verdictFor(reviewable, { category: 'purchase' }, savedCategory)).toEqual({
      category: { decision: 'corrected', value: 'purchase' },
    })
  })

  it('names the exact version shown, and carries only the pending fields', () => {
    expect(reviewRequest(reviewable, { priority: 'urgent' }, savedCategory)).toEqual({
      classification: subject,
      verdict: { priority: { decision: 'corrected', value: 'urgent' } },
    })
  })
})

describe('without', () => {
  it('forgets one field, so it records nothing and reads as untouched again', () => {
    const choices = { category: 'personal', priority: 'urgent' } as const

    expect(pendingFields(without(choices, 'category'), undefined)).toEqual(['priority'])
    expect(verdictFor(reviewable, without(choices, 'priority'), undefined)).toEqual({
      category: { decision: 'corrected', value: 'personal' },
    })
    expect(fieldStateFor('category', labels, without(choices, 'category'), undefined)).toEqual({
      label: 'Not reviewed',
      tone: 'none',
    })
  })
})

describe('decisionsIn', () => {
  it('reads back what one request decided, field by field', () => {
    expect(
      decisionsIn(
        {
          category: { decision: 'confirmed' },
          priority: { decision: 'corrected', value: 'urgent' },
        },
        labels,
      ),
    ).toEqual([
      // A confirmation carries no value, so the advised label is what it settled on.
      { field: 'category', value: 'newsletter', decision: 'confirmed' },
      { field: 'priority', value: 'urgent', decision: 'corrected' },
    ])
  })

  it('reads nothing from a request that decided no field', () => {
    expect(decisionsIn({}, labels)).toEqual([])
  })
})

describe('storedDecisions', () => {
  it('reads what the store holds for each field, and claims no other', () => {
    expect(storedDecisions(savedCategory)).toEqual([
      { field: 'category', value: 'personal', decision: 'corrected' },
    ])
    expect(storedDecisions(undefined)).toEqual([])
  })
})

describe("each field's own row", () => {
  it('says a field nobody decided is not reviewed, and names nobody for it', () => {
    expect(fieldStateFor('priority', labels, {}, savedCategory)).toEqual({
      label: 'Not reviewed',
      tone: 'none',
    })
    expect(decidedByFor('priority', savedCategory)).toBe('Nobody. The model decided this.')
  })

  it('says what a stored decision was, and who made it and when', () => {
    expect(fieldStateFor('category', labels, {}, savedCategory)).toEqual({
      label: 'Set to Personal',
      tone: 'saved',
    })
    expect(decidedByFor('category', savedCategory)).toMatch(/^wesley, /)
  })

  it('says a stored confirmation is a confirmation, not a change', () => {
    const confirmed: RowReview = {
      ...savedCategory,
      decision: 'confirmed',
      labels: { category: 'newsletter' },
      fields: { category: by('confirmed') },
    }

    expect(fieldStateFor('category', labels, {}, confirmed)).toEqual({
      label: 'Confirmed as Newsletter',
      tone: 'saved',
    })
  })

  it('distinguishes a change in progress from a confirmation in progress', () => {
    expect(fieldStateFor('priority', labels, { priority: 'urgent' }, undefined)).toEqual({
      label: 'Changing to Urgent. Not saved yet.',
      tone: 'pending',
    })
    expect(fieldStateFor('priority', labels, { priority: 'low' }, undefined)).toEqual({
      label: "Confirming the model's advice, Low. Not saved yet.",
      tone: 'pending',
    })
  })

  it('reads as stored again once a choice matches what is stored', () => {
    expect(fieldStateFor('category', labels, { category: 'personal' }, savedCategory)).toEqual({
      label: 'Set to Personal',
      tone: 'saved',
    })
  })
})

describe('reviewSignature', () => {
  const signature = reviewSignature(reviewable, undefined)

  it('is the same for the same version, labels and stored review', () => {
    expect(reviewSignature({ subject: { ...subject }, labels: { ...labels } }, undefined)).toBe(
      signature,
    )
    expect(reviewSignature(reviewable, { ...savedCategory })).toBe(
      reviewSignature(reviewable, savedCategory),
    )
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
    // The same value is a confirmation against one judgment and a correction
    // against another, so a choice cannot outlive them.
    expect(
      reviewSignature({ subject, labels: { ...labels, category: 'personal' } }, undefined),
    ).not.toBe(signature)
    expect(
      reviewSignature({ subject, labels: { ...labels, priority: 'urgent' } }, undefined),
    ).not.toBe(signature)
  })

  it('changes when a review is stored, changed or gone', () => {
    expect(reviewSignature(reviewable, savedCategory)).not.toBe(signature)
    expect(
      reviewSignature(reviewable, {
        ...savedCategory,
        fields: { category: by('confirmed') },
      }),
    ).not.toBe(reviewSignature(reviewable, savedCategory))
    expect(
      reviewSignature(reviewable, { ...savedCategory, labels: { category: 'purchase' } }),
    ).not.toBe(reviewSignature(reviewable, savedCategory))
    // A decision about another field is a change to what the panel shows too.
    expect(
      reviewSignature(reviewable, {
        ...savedCategory,
        labels: { ...savedCategory.labels, priority: 'urgent' },
        fields: { ...savedCategory.fields, priority: by('corrected') },
      }),
    ).not.toBe(reviewSignature(reviewable, savedCategory))
    expect(
      reviewSignature(reviewable, { ...savedCategory, reviewedAt: '2026-09-23T09:30:00.000Z' }),
    ).not.toBe(reviewSignature(reviewable, savedCategory))
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
    expect(reviewSignature(reviewable, { ...savedCategory, reviewer: 'someone else' })).toBe(
      reviewSignature(reviewable, savedCategory),
    )
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
      expect(words(state)).not.toMatch(/@|mail\.example/)
    }
  })

  it('says nothing is decided until a person decides a field', () => {
    expect(reviewResult({ status: 'choosing' })).toEqual({
      title: 'Nothing decided yet',
      detail:
        "Choose a value for a field, or choose the one marked as the model's advice to confirm it. A field you leave alone stays unreviewed. Your mailbox is unchanged.",
    })
  })

  it('counts what is ready to save, and says it decides nothing else', () => {
    expect(reviewResult({ status: 'unsaved', fields: 1 })).toEqual({
      title: '1 field ready to save',
      detail:
        'Saving records it on this computer, and decides nothing about any other field. Your mailbox is unchanged.',
    })
    expect(reviewResult({ status: 'unsaved', fields: 2 }).title).toBe('2 fields ready to save')
  })

  it('says what was saved, what is kept, and what stays unreviewed', () => {
    expect(
      reviewResult({
        status: 'saved',
        decided: [{ field: 'category', value: 'personal', decision: 'corrected' }],
      }),
    ).toEqual({
      title: 'Review saved',
      detail:
        "Category set to Personal. The model's own advice is kept. The priority stays unreviewed, as the model had it. Your mailbox is unchanged.",
    })
  })

  it('says a confirmation was a confirmation, and names both fields where both were decided', () => {
    expect(
      reviewResult({
        status: 'saved',
        decided: [
          { field: 'category', value: 'newsletter', decision: 'confirmed' },
          { field: 'priority', value: 'urgent', decision: 'corrected' },
        ],
      }).detail,
    ).toBe(
      "Category confirmed as Newsletter. Priority set to Urgent. The model's own advice is kept. Your mailbox is unchanged.",
    )
  })

  it('tells a reviewer of a version that moved on what to do next', () => {
    expect(reviewResult({ status: 'refused', reason: 'stale_subject' })).toEqual({
      title: 'Not saved',
      detail:
        'This triage is no longer the current one, so the review was refused. Refresh and open the message again to review what holds now.',
    })
  })

  it('says a failure stored nothing, rather than leaving it open', () => {
    expect(reviewResult({ status: 'failed' }).detail).toMatch(
      /could not be stored, so nothing was recorded/,
    )
  })
})

describe('reviewAnnouncement', () => {
  it('says nothing while a person is still choosing or saving', () => {
    expect(reviewAnnouncement({ status: 'choosing' })).toBe('')
    expect(reviewAnnouncement({ status: 'unsaved', fields: 1 })).toBe('')
    expect(reviewAnnouncement({ status: 'saving' })).toBe('')
  })

  it('announces a saved review as saved, and as not completed', () => {
    expect(
      reviewAnnouncement({
        status: 'saved',
        decided: [{ field: 'priority', value: 'urgent', decision: 'corrected' }],
      }),
    ).toBe(
      "Review saved. Priority set to Urgent. The model's own advice is kept. The category stays unreviewed, as the model had it. Your mailbox is unchanged. Not completed yet.",
    )
  })

  it('announces a refusal without claiming anything was saved', () => {
    const announced = reviewAnnouncement({ status: 'refused', reason: 'stale_subject' })

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

  it("keeps the model's advice, and names what the panel never decides", () => {
    const copy = reviewPanelCopy(labels)

    expect(copy.keptNote).toBe("The model's own advice is kept whatever you decide.")
    expect(copy.fieldsHint).toContain('A field you leave alone stays unreviewed')
    expect(copy.outOfScope).toBe(outOfScopeNote)
    expect(copy.outOfScope).toContain('category and the priority only')
    expect(copy.outOfScope).toContain('Whether a reply is expected, and by when, is not confirmed')
    expect(copy.cells).toEqual({
      advice: 'Model advises',
      decision: 'Your decision',
      decidedBy: 'Decided by',
    })
  })
})
