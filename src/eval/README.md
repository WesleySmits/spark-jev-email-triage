# Candidate evaluation set

`candidate-set.ts` holds the mail this repository measures triage against,
and the outcome it proposes for each thread. It is data and judgment only: it
calls nothing, so every test that uses it runs in CI without a provider, a
network or a secret.

## Confirmation status

**No person has read these labels yet.** They were written by Claude Opus 5,
running in T3 Code, from the mail and the rubric alone. Ticket 006 asks for
expected outcomes a person authored, so the set does not meet that bar and
the ticket stays open until one does.

Every case carries its own `curation`:

- `state` is `proposed` until a person reads the case and says the labels
  hold, and `confirmed` after.
- `by` names who wrote the labels, and `writtenOn` the day they were written.
  Neither is a review date, and there is no review date until there is a
  review.
- `confirmedBy` and `confirmedOn` name the person who confirmed and the day
  they did. They stay `null` while a case is `proposed`, and the set's test
  fails if a case claims a confirmation without naming both.

Confirming a case means reading its thread and its rubric, then keeping or
correcting the category, priority and handling, and saying so in the commit.
Correcting a proposal is the expected outcome, not a defect in it.

## What an expectation is

An expectation is the outcome proposed after reading the thread against
`defaultRubric` in `src/domain/rubric.ts`: a category, a priority, whether
the thread should go in front of a person, and the argument for all three.

- Expectations are written from the mail. They are never copied from a
  classifier answer, recomputed from `src/jev/policy.ts`, or adjusted to make
  a run agree. A yardstick built out of what it measures measures nothing,
  and `candidate-set.test.ts` fails if the module reaches for the classifier,
  the TypeSafe SDK or the environment.
- The argument matters as much as the labels. Whoever confirms a case should
  be able to disagree with the sentence rather than guess at it.
- Disagreement between the set and a classifier is a finding, not a defect in
  the set.

## What an expectation was written against

Each case names the subject and latest message id it was written against, and
the rubric id whose meanings its labels were chosen under. Provider order
decides which message is latest, as everywhere else in the domain.

Editing a labelled thread, or bumping the rubric id because a meaning or a
threshold changed, therefore fails the set's test. The labels are then read
again rather than carried onto mail, or into meanings, that nobody chose them
for.

## Provenance and privacy

Every case records where its mail came from.

- `invented` means no real message, person or address was involved at any
  point. Every case in the set today is invented.
- `sanitized` means a real message was rewritten. It is allowed only when the
  mailbox owner agrees, and its `note` must say what was removed and by whom.
  Sanitizing means replacing, not masking: names, addresses, links, order and
  account numbers, tracking tokens, quoted history and attachment contents go
  away entirely, and what is left must read as invented mail.
- Addresses and links use domains reserved by RFC 2606 or RFC 6761
  (`example.com`, `example.org`, `example.net`, `.example`, `.test`,
  `.invalid`). `src/domain/fixtures.test.ts` enforces this over every thread
  the set labels.
- Nothing here holds a credential, a real message id, a mailbox path or a
  provider response body. The set stores mail text on purpose, which is
  exactly why that text must be fictitious: the repository is public and its
  test output is not private.

The same rule holds for the rest of the repository, from the other direction:
mail subjects, addresses and bodies stay out of logs and public errors.
