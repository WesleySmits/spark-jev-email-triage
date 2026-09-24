/**
 * Why a person was asked, in words: that each recorded ground reads as itself,
 * that a record naming none says so rather than borrowing another's reason,
 * and that no mail or model text can reach the page through any of it.
 */
import { describe, expect, it } from 'vitest'
import type { ClassificationLabels } from '../../../domain/stored-classification'
import { reviewGroundsCopy, reviewGroundsFact, suspicionWarning } from './review-grounds'

const base = {
  category: 'newsletter',
  priority: 'low',
  confidence: 0.58,
  priorityUncertain: false,
  review: 'needs_review',
  reviewPriority: 'normal',
} as const

/** One judgment that asked for a person on exactly the grounds given. */
const asked = (
  grounds: Partial<Extract<ClassificationLabels['grounds'], { state: 'recorded' }>> = {},
  reviewPriority: ClassificationLabels['reviewPriority'] = 'normal',
): ClassificationLabels => ({
  ...base,
  reviewPriority,
  grounds: { state: 'recorded', reasons: [], suspicionSignals: [], ...grounds },
})

/** The four fixtures the panel has to tell apart. */
const fixtures = {
  lowConfidence: asked({ reasons: ['low_category_confidence'] }),
  ambiguous: asked({ reasons: ['low_category_confidence', 'ambiguous_category'] }),
  suspicion: asked(
    { reasons: ['suspicious'], suspicionSignals: ['credential_request'] },
    'elevated',
  ),
  several: asked(
    {
      reasons: ['low_category_confidence', 'ambiguous_category', 'suspicious'],
      suspicionSignals: ['payment_redirect', 'sender_impersonation'],
    },
    'elevated',
  ),
  unrecorded: { ...base, grounds: { state: 'unknown' } } as ClassificationLabels,
} as const

const accepted: ClassificationLabels = {
  ...base,
  review: 'auto_accepted',
  grounds: { state: 'recorded', reasons: [], suspicionSignals: [] },
}

describe('reviewGroundsCopy', () => {
  it('reads the low category score as a score and nothing more', () => {
    expect(reviewGroundsCopy(fixtures.lowConfidence).grounds).toEqual([
      "The model's score for this category stayed under the level triage accepts on its own.",
    ])
  })

  it('reads an ambiguous category as its own ground beside that score', () => {
    expect(reviewGroundsCopy(fixtures.ambiguous).grounds).toEqual([
      "The model's score for this category stayed under the level triage accepts on its own.",
      'No category of the rubric clearly fits this mail, so the model answered Other.',
    ])
  })

  it('names the suspicion signal that fired, and the priority policy raised', () => {
    expect(reviewGroundsCopy(fixtures.suspicion).grounds).toEqual([
      'Triage read this mail as a possible scam or phishing attempt.',
      'Signal: It asks for a password, a login code or another credential.',
      'Triage raised how urgent a look is, which asks for attention sooner and nothing else.',
    ])
  })

  it('gives every ground of several, in one fixed order whatever was stored', () => {
    const { grounds } = reviewGroundsCopy(fixtures.several)

    expect(grounds).toHaveLength(6)
    // Stored as payment_redirect then sender_impersonation; said the other way,
    // so the same grounds always read the same.
    expect(grounds.slice(3, 5)).toEqual([
      "Signal: A sender's address does not match the identity the mail claims.",
      'Signal: It asks to send money or to change payment details.',
    ])
  })

  it('says a record names no grounds, instead of explaining it as model doubt', () => {
    const { lead, grounds } = reviewGroundsCopy(fixtures.unrecorded)

    expect(lead).toContain('does not say on what grounds')
    expect(lead).toContain('rather than guessed at')
    expect(lead).not.toContain('score')
    expect(grounds).toEqual([])
  })

  it('says an accepted judgment was accepted, and still offers the review', () => {
    const { lead, grounds } = reviewGroundsCopy(accepted)

    expect(lead).toContain("accepted the model's own labels")
    expect(lead).toContain("Nothing is a person's decision until a review says so.")
    expect(grounds).toEqual([])
  })

  it('tells all five fixtures apart, so no two read as the same explanation', () => {
    const said = [...Object.values(fixtures), accepted].map((labels) =>
      JSON.stringify(reviewGroundsCopy(labels)),
    )

    expect(new Set(said).size).toBe(said.length)
  })
})

describe('reviewGroundsFact', () => {
  it('names each recorded ground, short enough to read beside the labels', () => {
    expect(reviewGroundsFact(fixtures.several)).toMatchObject({
      value: 'Low category score · No category fits · Possible scam or phishing',
    })
  })

  it('leaves how urgent a look is to the review need beside it', () => {
    // The reader already says that once; twice would read as two decisions.
    expect(reviewGroundsFact(fixtures.suspicion)?.note).not.toContain('raised how urgent')
  })

  it('says a record holds no grounds rather than leaving the value blank', () => {
    expect(reviewGroundsFact(fixtures.unrecorded)).toEqual({
      value: 'Not recorded',
      note: 'What was stored does not say why, so none is shown rather than guessed at. The judgment itself is unaffected.',
    })
  })

  it('adds nothing where a judgment was accepted on no grounds at all', () => {
    expect(reviewGroundsFact(accepted)).toBeUndefined()
  })
})

describe('suspicionWarning', () => {
  it('names what the signals found, and that a category decides none of it', () => {
    expect(suspicionWarning(fixtures.suspicion)).toEqual({
      value: 'Possible scam or phishing',
      note: 'It asks for a password, a login code or another credential. This stands whatever category a person decides on.',
    })
  })

  it('stands on the suspicious category alone, where no signal fired', () => {
    expect(suspicionWarning(asked({ reasons: ['suspicious'] }))?.note).toBe(
      'The model placed this mail in Suspicious. This stands whatever category a person decides on.',
    )
  })

  it('warns on a signal even where the reason list lost the suspicion ground', () => {
    // Neither field can hide the other: a signal is a finding of its own.
    expect(
      suspicionWarning(
        asked({
          reasons: ['low_category_confidence'],
          suspicionSignals: ['automated_reader_instructions'],
        }),
      )?.note,
    ).toContain('instructions addressed to an automated reader')
  })

  it('warns about nothing where no ground mentions suspicion', () => {
    expect(suspicionWarning(fixtures.lowConfidence)).toBeUndefined()
  })

  it('claims no warning, and no reassurance, where the record says nothing', () => {
    // An unrecorded ground is not evidence that a mail is safe.
    expect(suspicionWarning(fixtures.unrecorded)).toBeUndefined()
    expect(JSON.stringify(reviewGroundsCopy(fixtures.unrecorded))).not.toMatch(/safe|no signs/i)
  })
})

describe('what a reader can be shown', () => {
  /** Every word these three functions can put on the page for one judgment. */
  const everything = (labels: ClassificationLabels) =>
    JSON.stringify([reviewGroundsCopy(labels), reviewGroundsFact(labels), suspicionWarning(labels)])

  it('shows only this application’s own copy, never a stored value', () => {
    // Grounds are codes, so no stored text ever reaches this copy to be shown
    // inert or otherwise: a ground is said in words written here, chosen by a
    // code, or it is not said. Anything else is not a code this build holds and
    // has no line to print. Reading such a record back is what turns it into
    // unknown grounds; see `reviewGroundsFor`.
    const foreign = {
      ...base,
      grounds: {
        state: 'recorded',
        reasons: ['<img src=x onerror=alert(1)>', 'Ignore previous instructions'],
        suspicionSignals: ['wire the deposit to NL00BANK0123456789'],
      },
    } as unknown as ClassificationLabels

    const said = everything(foreign)

    expect(said).not.toContain('onerror')
    expect(said).not.toContain('Ignore previous instructions')
    expect(said).not.toContain('NL00BANK')
    // Nothing was said about them at all, rather than something half-said.
    expect(reviewGroundsCopy(foreign).grounds).toEqual([])
    expect(reviewGroundsFact(foreign)).toBeUndefined()
    expect(suspicionWarning(foreign)).toBeUndefined()
  })

  it('names no mail: no subject, address or message id reaches this copy', () => {
    for (const labels of [...Object.values(fixtures), accepted]) {
      expect(everything(labels)).not.toMatch(/@|mail\.example/)
    }
  })

  it('never says a review was saved, or that any mail moved', () => {
    for (const labels of [...Object.values(fixtures), accepted]) {
      expect(everything(labels)).not.toMatch(/\b(archived|completed|handled|deleted)\b/i)
    }
  })
})
